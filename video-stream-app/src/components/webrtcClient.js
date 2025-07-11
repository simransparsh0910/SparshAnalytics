const restartPause = 8000; // Initial retry delay (5s)
const maxRetries = 50; // Max retries before switching to background mode
// const backgroundRetryInterval = 30000; // Background retry every 30s

const unquoteCredential = (v) => JSON.parse(`"${v}"`);

const linkToIceServers = (links) =>
  links !== null
    ? links.split(', ').map((link) => {
        const m = link.match(
          /^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i
        );
        const ret = { urls: [m[1]] };

        if (m[3] !== undefined) {
          ret.username = unquoteCredential(m[3]);
          ret.credential = unquoteCredential(m[4]);
          ret.credentialType = 'password';
        }

        return ret;
      })
    : [];

const parseOffer = (offer) => {
  const ret = { iceUfrag: '', icePwd: '', medias: [] };

  offer.split('\r\n').forEach((line) => {
    if (line.startsWith('m=')) ret.medias.push(line.slice('m='.length));
    else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:'))
      ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
    else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:'))
      ret.icePwd = line.slice('a=ice-pwd:'.length);
  });

  return ret;
};

const generateSdpFragment = (offerData, candidates) => {
  const candidatesByMedia = {};

  candidates.forEach((candidate) => {
    const mid = candidate.sdpMLineIndex;
    if (!candidatesByMedia[mid]) candidatesByMedia[mid] = [];
    candidatesByMedia[mid].push(candidate);
  });

  let frag = `a=ice-ufrag:${offerData.iceUfrag}\r\na=ice-pwd:${offerData.icePwd}\r\n`;

  let mid = 0;
  offerData.medias.forEach((media) => {
    if (candidatesByMedia[mid]) {
      frag += `m=${media}\r\na=mid:${mid}\r\n`;
      candidatesByMedia[mid].forEach((candidate) => {
        frag += 'a=' + candidate.candidate + '\r\n';
      });
    }
    mid++;
  });

  return frag;
};

class WHEPClient {
  constructor(url, id, onLoadingStateChange) {
    this.pc = null;
    this.restartTimeout = null;
    this.videoElement = document.getElementById(id) || document.querySelector(`#${id}`);
    this.url = url;
    this.id = id;
    this.eTag = '';
    this.queuedCandidates = [];
    this.retryCount = 0;
    this.connected = false;
    this.backgroundRetry = null;
    this.onLoadingStateChange = onLoadingStateChange;

    this.start();
  }

  start() {
    console.log(`Starting WebRTC client for ${this.url} (Retry: ${this.retryCount})`);
    
    this.onLoadingStateChange(true); // Show "Loading..." UI

    fetch(new URL('whep', this.url), { method: 'OPTIONS' })
      .then((res) => this.onIceServers(res))
      .catch((err) => {
        console.error('Error fetching ICE servers:', err);
        this.scheduleRestart();
      });
  }

  onIceServers(res) {
    if (this.retryCount >= maxRetries && this.backgroundRetry !== null) {
      console.warn('Max retries reached. Switching to background retry mode.');
      return;
    }

    this.pc = new RTCPeerConnection({
      iceServers: linkToIceServers(res.headers.get('Link')),
    });

    const direction = 'sendrecv';
    this.pc.addTransceiver('video', { direction });
    this.pc.addTransceiver('audio', { direction });

    this.pc.onicecandidate = (evt) => this.onLocalCandidate(evt);
    this.pc.oniceconnectionstatechange = () => this.onConnectionState();

    this.pc.ontrack = (evt) => {
      console.log('New track received:', evt.track.kind);
      const videoElement = document.getElementById(this.id);
    
      if (videoElement) {
        videoElement.srcObject = evt.streams[0];
      } else {
        console.error(`Video element with ID "${this.id}" not found.`);
      }
      this.connected = true;
      this.retryCount = 0;
      this.onLoadingStateChange(false); // Hide "Loading..." UI

      if (this.backgroundRetry) {
        clearInterval(this.backgroundRetry);
        this.backgroundRetry = null;
      }
    };

    this.pc.createOffer().then((offer) => this.onLocalOffer(offer));
  }

  onLocalOffer(offer) {
    this.offerData = parseOffer(offer.sdp);
    this.pc.setLocalDescription(offer);

    fetch(`${this.url}/whep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    })
      .then((res) => {
        if (res.status !== 201) {
          throw new Error('Bad status code');
        }
        this.eTag = res.headers.get('E-Tag');
        return res.text();
      })
      .then((sdp) => {
        this.onRemoteAnswer(new RTCSessionDescription({ type: 'answer', sdp }));
      })
      .catch((err) => {
        console.error('Error sending offer to WHEP server:', err);
        this.scheduleRestart();
      });
  }

  onRemoteAnswer(answer) {
    if (this.restartTimeout !== null) return;
    this.pc.setRemoteDescription(new RTCSessionDescription(answer));

    if (this.queuedCandidates.length !== 0) {
      this.sendLocalCandidates(this.queuedCandidates);
      this.queuedCandidates = [];
    }

    this.connected = true;
    this.retryCount = 0;
    this.onLoadingStateChange(false); // Hide "Loading..." UI
  }

  onLocalCandidate(evt) {
    if (this.restartTimeout !== null) return;
    if (evt.candidate !== null) {
      if (this.eTag === '') {
        this.queuedCandidates.push(evt.candidate);
      } else {
        this.sendLocalCandidates([evt.candidate]);
      }
    }
  }

  sendLocalCandidates(candidates) {
    fetch(`${this.url}/whep`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/trickle-ice-sdpfrag',
        'If-Match': this.eTag,
      },
      body: generateSdpFragment(this.offerData, candidates),
    }).catch((err) => {
      console.error('Error sending ICE candidates:', err);
      this.scheduleRestart();
    });
  }

  scheduleRestart() {
    console.log(this.connected, "Connected ?");

    if (this.restartTimeout !== null) return;

    if (this.retryCount < maxRetries) {
        console.warn(`Reconnecting in ${restartPause / 1000} seconds... (Attempt ${this.retryCount + 1}/${maxRetries})`);
        this.onLoadingStateChange(true);

        this.retryCount++;
        this.restartTimeout = setTimeout(() => {
            this.restartTimeout = null;
            this.start();
        }, restartPause);
    } else {
        console.warn("Max retries exceeded. Pausing retries for 10 minutes before resetting count...");

        // Stop all retries and wait for 10 minutes before restarting
        if (!this.backgroundRetry) {
            this.backgroundRetry = setTimeout(() => {
                console.warn("Cooldown period over. Restarting normal retries...");
                this.retryCount = 0; // Reset retry count after cooldown
                this.backgroundRetry = null;
                this.scheduleRestart(); // Restart normal retry process
            }, 10 * 60 * 1000); // 10-minute cooldown
        }
    }

    this.eTag = '';
    this.queuedCandidates = [];
    this.connected = false;
  }
  
  captureFrame() {
    if (!this.videoElement) return null;

    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  destroy() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.backgroundRetry) {
      clearInterval(this.backgroundRetry);
      this.backgroundRetry = null;
    }
    this.connected = false;
  }

  onConnectionState() {
    console.log(`ICE connection state: ${this.pc.iceConnectionState}`);

    if (this.pc.iceConnectionState === 'connected') {
      console.log('WebRTC connection established');
      this.connected = true;
      this.retryCount = 0;
      this.onLoadingStateChange(false); // Hide "Loading..." UI

      if (this.backgroundRetry) {
        clearInterval(this.backgroundRetry);
        this.backgroundRetry = null;
      }
    }

    if (this.pc.iceConnectionState === 'failed' || this.pc.iceConnectionState === 'disconnected') {
      console.warn('WebRTC connection lost. Showing loading state and reconnecting...');
      this.onLoadingStateChange(true); // Show "Loading..." UI
      this.scheduleRestart();
    }
  }
}

export { WHEPClient };
