import React from 'react';
import { useLocation } from 'react-router-dom';

const Footer = ({ gridSize, onGridChange }) => {
  const location = useLocation();
  const gridSizes = [1, 2, 3, 4, 5, 6];

  // Check if current path starts with "/dashboard"
  const isDashboard = location.pathname.startsWith('/dashboard');

  return (
    <footer style={styles.footer}>
      {isDashboard ? (
        <>
          <div style={styles.leftSection}>
            {gridSizes.map((size) => (
              <button
                key={size}
                style={{
                  ...styles.button,
                  backgroundColor: gridSize === size ? '#007bff' : '#e0e0e0',
                  color: gridSize === size ? 'white' : 'black',
                }}
                onClick={() => onGridChange(size)}
              >
                {size}x{size}
              </button>
            ))}
          </div>
          <div style={styles.rightSection}>
            <p style={styles.text}>
             {/* © {new Date().getFullYear()} Samriddhi Automation Pvt. Ltd. — All rights reserved. | Version 2.0 */}
            </p>
          </div>
        </>
      ) : (
        <div style={styles.centerText}>
          <p style={styles.text}>
          {/*  © {new Date().getFullYear()} Samriddhi Automation Pvt. Ltd. — All rights reserved. | Version 2.0 */}
          </p>
        </div>
      )}
    </footer>
  );
};

const styles = {
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center', // Center content by default
    backgroundColor: '#f5f5f5',
    padding: '10px 20px',
    borderTop: '1px solid #ddd',
    width: '100%',
    boxSizing: 'border-box',
  },
  leftSection: {
    flex: '0 0 70%',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  rightSection: {
    flex: '0 0 30%',
    textAlign: 'right',
  },
  centerText: {
    textAlign: 'center',
    width: '100%',
  },
  button: {
    padding: '6px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
    minWidth: '60px',
  },
  text: {
    margin: 0,
    color: '#555',
    fontSize: '14px',
    fontWeight: 500,
  },
};

export default Footer;

