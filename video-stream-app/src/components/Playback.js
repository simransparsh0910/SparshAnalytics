import React, { useState, useEffect } from 'react'
import VideoGrid from './VideoGrid';
import EventList from './EventList';
import Menu from './Menu';
import '../App.css';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';


const Dashboard = () => {
  const [streams, setStreams] = useState([]); 
  const [gridSize, setGridSize] = useState(2);

  const navigate = useNavigate();
   useEffect(() => {
        const checkAuth = async () => {
            try {
                const authData = await ValidateAuth();
                if (!authData || (authData.user.role !== 'SuperAdmin' && !(authData.user.rights?.['Show Playback']))) {
                    navigate('/login');
                } 
            } catch (error) {
                console.error('Error validating auth:', error);
                navigate('/login');
            }
        };
        checkAuth();
    }, [navigate]);

  const handleDeviceSelected = (streamUrl, index) => {
    setStreams((prevStreams) => {
      const updatedStreams = [...prevStreams];
      updatedStreams[index] = {url:streamUrl,index:index}; 
      return updatedStreams;
    });
  };

  // Handle closing a stream for a specific tile
  const handleStreamClose = (index) => {
    setStreams((prevStreams) => {
      const updatedStreams = [...prevStreams];
      updatedStreams[index] = null; // Set the stream to null (no stream)
      return updatedStreams;
    });
  };

  // Handle grid size change
  const handleGridChange = (event) => {
    const newGridSize = parseInt(event.target.value);

    setStreams((prevStreams) => {
      const newStreams = [...prevStreams];

      // Ensure the streams array has enough elements for the new grid size
      const totalTiles = newGridSize * newGridSize;
      if (newStreams.length < totalTiles) {
        for (let i = newStreams.length; i < totalTiles; i++) {
          newStreams.push(null); // Add null for new grid cells with no streams
        }
      }
      return newStreams;
    });

    setGridSize(newGridSize);
  };

  return (
    <div className="app-container">
        <header className="header-menu">
          <div>
            <Menu />
          </div>
        </header>
      
      <div className="content-container">
        <div className="video-section">
          <VideoGrid gridSize={gridSize} streams={streams} handleStreamClose={handleStreamClose} eventShow = {false}/>
        </div>
        <div className="event-section">
          <EventList onDeviceSelected={handleDeviceSelected} eventShow = {false}/>
          <div className="grid-selector-sidebar">
            <label htmlFor="gridSize">Select Grid Size:</label>
            <select id="gridSize" value={gridSize} onChange={handleGridChange}>
              <option value={1}>1x1</option>
              <option value={2}>2x2</option>
              <option value={3}>3x3</option>
              <option value={4}>4x4</option>
              <option value={5}>5x5</option>
              <option value={6}>6x6</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard
