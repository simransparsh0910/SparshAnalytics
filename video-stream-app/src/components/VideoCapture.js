import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stage, Layer, Rect } from 'react-konva';

const VideoCapture = ({ videoUrl }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const [capturedFrame, setCapturedFrame] = useState(null);
  const [roi, setRoi] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [videoHidden, setVideoHidden] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(`${process.env.REACT_APP_WEBSOCKET_URL}`);
    socket.onopen = () => console.log('WebSocket connected');
    socket.onmessage = (event) => {
      try {
        const receivedData = JSON.parse(event.data);
        if (receivedData.type === "attributes") { 
          navigate('/detectFacesReport', { state: { data: receivedData.data } });
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    socket.onerror = (error) => console.error('WebSocket error:', error);
    socket.onclose = () => console.log('WebSocket disconnected');
    return () => socket.close();
  }, [navigate]);

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video && canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Compress image
      const compressedImage = canvas.toDataURL('image/jpeg', 0.5); // 50% quality
      setCapturedFrame(compressedImage);
      setVideoHidden(true);
    }
  };

  // Rectangle Drawing Logic
  const handleMouseDown = (e) => {
    const { x, y } = e.target.getStage().getPointerPosition();
    setRoi({ x, y, width: 0, height: 0 });
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    const { x, y } = e.target.getStage().getPointerPosition();
    setRoi((prev) => ({
      ...prev,
      width: x - prev.x,
      height: y - prev.y,
    }));
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
     setRoi((prev) => ([
    { x: prev.x, y: prev.y },  // Top-left
    { x: prev.x, y: prev.y + prev.height },  // Bottom-left
    { x: prev.x + prev.width, y: prev.y + prev.height },  // Bottom-right
    { x: prev.x + prev.width, y: prev.y }  // Top-right
  ]));
  };

  const handleSubmit = async () => {
    const payload = { image: capturedFrame,  roi: roi || [], }
    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/save-roi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      //alert(response.ok ? 'ROI submitted successfully!' : 'Failed to submit ROI');
    } catch (error) {
      console.error('Error submitting ROI:', error);
    }
  };

  return (
    <div>
      {!videoHidden && (
        <video ref={videoRef} src={videoUrl} autoPlay muted controls width="100%" crossOrigin="anonymous" />
      )}

      {!capturedFrame && <button onClick={captureFrame}>Capture Frame</button>}

      {capturedFrame && (
        <div>
          <h3>Captured Frame</h3>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={capturedFrame} alt="Captured Frame" style={{ width: '500px' }} />
            <Stage
              width={500}
              height={300}
              style={{ position: 'absolute', top: 0, left: 0 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <Layer>
                {roi && (
                  <Rect
                    x={roi.x}
                    y={roi.y}
                    width={roi.width}
                    height={roi.height}
                    stroke="red"
                    strokeWidth={2}
                  />
                )}
              </Layer>
            </Stage>
          </div>
          <button onClick={handleSubmit}>Submit</button>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default VideoCapture;

