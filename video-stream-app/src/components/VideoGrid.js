import React, { useEffect, useRef, useState } from 'react';
import './VideoGrid.css';
import { WHEPClient } from './webrtcClient';
import playImage from '../play.png';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer } from 'react-konva';

import { useNavigate } from 'react-router-dom';

const toggleFullscreen = (element) => {
  if (!document.fullscreenElement) {
    if (element.requestFullscreen) element.requestFullscreen();
    else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
    else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
    else if (element.msRequestFullscreen) element.msRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
};

const VideoGrid = ({ gridSize, streams,updateStreamUrl, eventShow }) => {
  const videoRefs = useRef([]);
  const clientRefs = useRef([]);
  const stageRef = useRef(null);
  console.log(gridSize,"gridSize");

  const [loadingStates, setLoadingStates] = useState(Array(gridSize * gridSize).fill(true));
  
  const [popupVisible, setPopupVisible] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [rectProps, setRectProps] = useState({ x: 50, y: 50, width: 100, height: 100 });
  const [konvaImage, setKonvaImage] = useState(null);

const navigate = useNavigate();

  useEffect(() => {
    if (eventShow) {
      videoRefs.current.forEach((videoElement, index) => {
        const streamUrl = streams[index];
        if (videoElement && streamUrl) {
          if (!clientRefs.current[index]) {
            initializeClient(index, streamUrl, videoElement);
          }
        }
      });
    }
  }, [streams, eventShow]);

  // Pause videos when the tab is inactive and resume when active
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('Tab is hidden, pausing all videos...');
        videoRefs.current.forEach((video) => {
          if (video && !video.paused) {
            video.pause();
            video.setAttribute('data-paused', 'true');
          }
        });
      } else {
        console.log('Tab is visible, resuming videos...');
        videoRefs.current.forEach((video) => {
          if (video && video.getAttribute('data-paused') === 'true') {
            video.play().catch((error) => console.error('Error resuming video:', error));
            video.removeAttribute('data-paused');
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const initializeClient = (index, streamUrl, videoElement) => {
    console.log('Initializing client for:', streamUrl);
    
    const updateLoadingState = (isLoading) => {
      setLoadingStates((prev) => {
        const newStates = [...prev];
        newStates[index] = isLoading;
        return newStates;
      });
    };

    // Create a new WebRTC client and store the reference
    const client = new WHEPClient(streamUrl, `video-${index}`, updateLoadingState);
    clientRefs.current[index] = client;
  };

  // const updateLoadingState = (index, isLoading) => {
  //   setLoadingStates((prev) => {
  //     const newStates = [...prev];
  //     newStates[index] = isLoading;
  //     return newStates;
  //   });
  // };

const handleCrop = () => {
  const image = new window.Image();
  image.src = capturedImage;

  image.onload = () => {
    const actualImageWidth = image.width;
    const actualImageHeight = image.height;

    const displayWidth = stageRef.current.width();
    const displayHeight = stageRef.current.height();

    const scaleX = actualImageWidth / displayWidth;
    const scaleY = actualImageHeight / displayHeight;

    const cropX = rectProps.x * scaleX;
    const cropY = rectProps.y * scaleY;
    const cropWidth = rectProps.width * scaleX;
    const cropHeight = rectProps.height * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      image,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight
    );

    const croppedDataUrl = canvas.toDataURL('image/png');
    const base64Data = croppedDataUrl.replace(/^data:image\/png;base64,/, '');
    console.log("✅ Base64 Cropped Image (without prefix):", base64Data);

    navigate('/manageFaces', { state: { croppedImage: base64Data } });
  };
};

  const handleDoubleClick = (index) => {
    const videoElement = document.getElementById(`video-${index}`);
    if (videoElement) toggleFullscreen(videoElement);
  };
  
  const handleSingleClick = (index) => {
  const video = videoRefs.current[index];
  if (!video) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageDataUrl = canvas.toDataURL('image/png');
  const image = new window.Image();
  image.src = imageDataUrl;
  image.onload = () => {
    setKonvaImage(image);
    setCapturedImage(imageDataUrl);
    setPopupVisible(true);
  };
};

const handleCloseStream = (index) => {
    updateStreamUrl(index, null); // ✅ Tell parent to clear this stream
  
    const videoEl = videoRefs.current[index];
    if (videoEl?.srcObject) {
      videoEl.srcObject.getTracks().forEach((track) => track.stop());
      videoEl.srcObject = null;
    }
  
    if (clientRefs.current[index]) {
      clientRefs.current[index].close?.();
      clientRefs.current[index] = null;
    }
  };


  return (
    <div className={`video-grid grid-${gridSize}`}>
      {Array(gridSize * gridSize)
        .fill('')
        .map((_, index) => (
        <div key={index} className="video-tile" onDoubleClick={() => handleDoubleClick(index)} onClick={() => handleSingleClick(index)}>
            {streams[index] ? (
              <>
              <div className="video-container">
                  <button className="stream-close-btn" onClick={(e) => {
                    e.stopPropagation(); // prevent triggering full screen
                    handleCloseStream(index);
                  }}>
                    &times;
                  </button>
                {loadingStates[index] && <div className="loader">Loading...</div>}
                <video
                  id={`video-${index}`}
                  ref={(el) => (videoRefs.current[index] = el)}
                  width="100%"
                  autoPlay
                  muted
                />
                </div>
              </>
            ) : (
              <div className="no-stream">
                <img src={playImage} alt="Play Icon" className="stream-icon" />
              </div>
            )}
          </div>
        ))}
        {popupVisible && (
  <div className="popup-overlay">
    <div className="popup-content">
      <button
  className="close-btn"
  onClick={() => {
    setPopupVisible(false);
    setCapturedImage(null);
    setKonvaImage(null);
    setRectProps({ x: 50, y: 50, width: 100, height: 100 }); // reset rectangle
  }}
>
  ✕
</button>

     <Stage width={500} height={400} ref={stageRef}>
  <Layer>
    {konvaImage && <KonvaImage image={konvaImage} width={500} height={400} />}
    <Rect
      {...rectProps}
      fill="rgba(0,0,255,0.2)"
      stroke="blue"
      strokeWidth={2}
      draggable
      onClick={(e) => {
        const stage = stageRef.current;
        const tr = stage.findOne('Transformer');
        tr.nodes([e.target]);
        tr.getLayer().batchDraw();
      }}
      onDragEnd={(e) =>
        setRectProps((prev) => ({
          ...prev,
          x: e.target.x(),
          y: e.target.y()
        }))
      }
      onTransformEnd={(e) => {
        const node = e.target;
        setRectProps({
          x: node.x(),
          y: node.y(),
          width: node.width() * node.scaleX(),
          height: node.height() * node.scaleY()
        });
        node.scaleX(1);
        node.scaleY(1);
      }}
    />
    <Transformer
      ref={(node) => {
        if (node && stageRef.current) {
          const rect = stageRef.current.findOne('Rect');
          if (rect) node.nodes([rect]);
        }
      }}
      boundBoxFunc={(oldBox, newBox) => {
        // prevent resizing smaller than 20x20
        if (newBox.width < 20 || newBox.height < 20) return oldBox;
        return newBox;
      }}
    />
  </Layer>
</Stage>


      <button className="confirm-btn" onClick={handleCrop}>Crop & Go</button>
    </div>
  </div>
)}

    </div>
  );
};

export default VideoGrid;
