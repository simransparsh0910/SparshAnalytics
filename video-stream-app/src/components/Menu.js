import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ValidateAuth } from '../ValidateAuth';
import { useLocation } from 'react-router-dom';
import PersonIcon from '@mui/icons-material/Person';
import './Menu.css';

const Menu = () => {
  const [userRole, setUserRole] = useState("");
  const [username, setUsername] = useState("");
  const [userRights, setUserRights] = useState({});
  const navigate = useNavigate();
   const [isCaptureEnabled, setIsCaptureEnabled] = useState(false);
  const location = useLocation();
  const isOnDashboard = location.pathname === '/dashboard';
    const sparshLogo = "/sp-logo.png"

const handleToggleCapture = async (e) => {
  const checked = e.target.checked;
  setIsCaptureEnabled(checked);

  try {
    const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/toggle-capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: checked }),
    });

    if (!response.ok) {
      throw new Error("Failed to update capture status");
    }

    const result = await response.json();
    console.log("Capture toggle response:", result);
  } catch (err) {
    console.error("Error toggling capture:", err);
  }
};


  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Validate authentication and get user data
        const authData = await ValidateAuth();
        if (!authData) {
          navigate('/login');
        } else {
          setUserRole(authData.user.role);
          setUsername(authData.user.username);
          setUserRights(authData.user.rights); // Store user rights
        }
      } catch (error) {
        console.error('Error validating auth:', error);
        navigate('/login'); // Navigate to login on error
      }
    };
    checkAuth();
  }, [navigate]);
  console.log(username)

  const canAccessCamera = userRights['Add Camera'] || userRights['Delete Camera'];
  const canAccessFace = userRights['Add Face'] || userRights['Delete Face'];
  const canAccessPlayback = userRights['Show Playback'];

  return (
    <nav className="navbar">
     <div className="navbar-left">
    {/*  <img src={sparshLogo} alt="Sparsh Logo" className="logo" /> */}
    </div>
    <div className="navbar-center">
      <ul className="menu-list">
        <li className="menu-item"><Link to="/dashboard">Dashboard</Link></li>

        {/* Faces: SuperAdmin, Admin, AdminFrs */}
        {(userRole === 'SuperAdmin' || username === 'admin@sparsh.com' || username === 'adminfrs@sparsh.com') && (
          <li className="menu-item"><Link to="/manageFaces">Faces</Link></li>
        )}

        {/* FRS: SuperAdmin, Admin, AdminFrs */}
        {(userRole === 'SuperAdmin' || username === 'admin@sparsh.com' || username === 'adminfrs@sparsh.com') && (
          <li className="menu-item"><Link to="/detectFacesReport">FRS</Link></li>
        )}

        {/* VA: SuperAdmin, Admin, AdminVa */}
        {(userRole === 'SuperAdmin' || username === 'admin@sparsh.com' || username === 'adminva@sparsh.com') && (
          <li className="menu-item"><Link to="/vaDetectReport">VA</Link></li>
        )}

        {/* Cameras: SuperAdmin or roles with access (assuming all Admin types have camera access) */}
        {(userRole === 'SuperAdmin' || canAccessCamera) && (
          <li className="menu-item"><Link to="/manageCameras">Cameras</Link></li>
        )}

        {/* SuperAdmin-only */}
        {userRole === 'SuperAdmin' && (
          <>
            <li className="menu-item"><Link to="/addUser">Users</Link></li>
            <li className="menu-item"><Link to="/manageRoles">Role</Link></li>
            <li className="menu-item"><Link to="/alerts">Alerts</Link></li>
            <li className="menu-item"><Link to="/config">Config</Link></li>
            <li className="menu-item"><Link to="/settings">Settings</Link></li>
            <li className="menu-item"><Link to="/logs">Logs</Link></li>
          </>
        )}

        {/* Logout */}
        <li className="menu-item"><Link to="/logout">LogOut</Link></li>
      </ul>
    </div>

      
      {/*
      {isOnDashboard && (
        <div className="capture-toggle">
          <label className="capture-text">
            <input
              type="checkbox"
              checked={isCaptureEnabled}
              onChange={handleToggleCapture}
            />
            Auto Enroll
          </label>
        </div>
      )}
      */}
      <div className="navbar-right">
   <PersonIcon style={{ fontSize: 32, cursor: 'pointer', color: '#555' }} />
  </div>
    </nav>
  );
};

export default Menu;
