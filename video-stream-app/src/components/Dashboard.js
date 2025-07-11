// Dashboard.js
import React, { useState, useEffect } from 'react';
import VideoGrid from './VideoGrid';
import EventList from './EventList';
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout';

const Dashboard = ({ gridSize, sessionId, xsrfToken }) => {
  const serverIp = window.location.hostname;
  const storageKey = `activeStreams_${serverIp}`;
  const navigate = useNavigate();

  const [streams, setStreams] = useState(() => {
    const savedStreams = localStorage.getItem(storageKey);
    return savedStreams ? JSON.parse(savedStreams) : [];
  });

  useEffect(() => {
    const checkAuth = async () => {
      const authData = await ValidateAuth();
      if (!authData) {
        navigate('/login');
      }
    };
    checkAuth();
  }, [navigate]);
  
   const updateStreamUrl = (index, newUrl) => {
        setStreams((prevStreams) => {
            const updatedStreams = [...prevStreams];
            updatedStreams[index] = newUrl;
            localStorage.setItem(storageKey, JSON.stringify(updatedStreams));
            return updatedStreams;
        });
    };

  const handleDeviceSelected = (streamUrl, index) => {
    setStreams((prevStreams) => {
      const updatedStreams = [...prevStreams];
      updatedStreams[index] = streamUrl;
      localStorage.setItem(storageKey, JSON.stringify(updatedStreams));
      return updatedStreams;
    });
  };

  const handleStreamClose = (index) => {
    setStreams((prevStreams) => {
      const updatedStreams = [...prevStreams];
      updatedStreams[index] = null;
      localStorage.setItem(storageKey, JSON.stringify(updatedStreams));
      return updatedStreams;
    });
  };
  console.log(gridSize,"gridsize in dashboard")

  return (
  <div className="app-container">
      <header className="header-menu">
          <Menu />
       </header>

      <div className="content-container">
        <div className="video-section">
          <VideoGrid
            gridSize={gridSize}
            streams={streams}
            handleStreamClose={handleStreamClose}
             updateStreamUrl={updateStreamUrl} 
            eventShow={true}
          />
        </div>
        <div className="event-section">
          <EventList onDeviceSelected={handleDeviceSelected} eventShow={true} />
        </div>
      </div>
      </div>
   
  );
};

export default Dashboard;

