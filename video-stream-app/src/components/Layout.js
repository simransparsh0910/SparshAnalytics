import React, { useState } from 'react';
import Footer from './Footer';

const Layout = ({ children }) => {
  const serverIp = window.location.hostname;
  const storageKey = `activeStreams_${serverIp}`;

  const [gridSize, setGridSize] = useState(() => {
    const savedStreams = localStorage.getItem(storageKey);
    // console.log(JSON.parse(savedStreams).length,"streams length")
    const defaultLength = savedStreams ? JSON.parse(savedStreams).length : 4;
    const size = Math.floor(Math.sqrt(defaultLength));
    console.log(size,"size");
    return size >= 1 ? size : 2;
  });

  const handleGridChange = (newGridSize) => {
    const totalTiles = newGridSize * newGridSize;
    const savedStreams = localStorage.getItem(storageKey);
    const existingStreams = savedStreams ? JSON.parse(savedStreams) : [];

    while (existingStreams.length < totalTiles) {
      existingStreams.push(null);
    }

    const updatedStreams = existingStreams.slice(0, totalTiles);
    localStorage.setItem(storageKey, JSON.stringify(updatedStreams));
    setGridSize(newGridSize);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
    },
    main: {
      flex: 1,
    }
  };

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        {React.cloneElement(children, { gridSize })}
      </main>
      <Footer gridSize={gridSize} onGridChange={handleGridChange} />
    </div>
  );
};

export default Layout;

