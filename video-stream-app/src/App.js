import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ManageFaces from './components/ManageFaces';
import DetectFacesReport from './components/DetectFacesReport';
import VaDetectedReport from './components/VaDetectedReport';
import Dashboard from './components/Dashboard';
import LoginPage from './components/Login';
import AddUser from './components/AddUser';
import Logout from './components/Logout';
import ManageCameras from './components/ManageCameras';
import ManageRoles from './components/ManageRoles';
import LogsPage from './components/LogsPage';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import DashboardPage from './components/DashboardPage';
import Setting from './components/Setting';
import Alerts from './components/Alerts';
import Config from './components/Config';

const App = () => {
  // State to store session ID
  const [sessionId, setSessionId] = useState("");
  const [xsrfToken, setXsrfToken] = useState("");

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        
        <Route 
          path="/login" 
          element={<LoginPage setSessionId={setSessionId} setXsrfToken={setXsrfToken} xsrfToken={xsrfToken}/>} 
        />
        
       <Route 
  path="/dashboard/*" 
  element={<DashboardPage sessionId={sessionId} xsrfToken={xsrfToken} />} 
/>
<Route 
  path="/alerts" 
  element={<Alerts sessionId={sessionId} xsrfToken={xsrfToken} />} 
/>
<Route path="/config" element={<Config/>} />

        <Route 
          path="/manageFaces" 
          element={<ManageFaces xsrfToken={xsrfToken}/>} 
        />
        
        <Route 
          path="/detectFacesReport" 
          element={<DetectFacesReport sessionId={sessionId} xsrfToken={xsrfToken}/>} 
        />

        <Route 
          path="/vaDetectReport" 
          element={<VaDetectedReport sessionId={sessionId} xsrfToken={xsrfToken}/>} 
        />

        <Route 
          path="/addUser" 
          element={<AddUser xsrfToken={xsrfToken}/>} 
        />

        <Route 
          path="/manageCameras" 
          element={<ManageCameras xsrfToken={xsrfToken}/>} 
        />

        <Route 
          path="/manageRoles" 
          element={<ManageRoles sessionId={sessionId} xsrfToken={xsrfToken}/>} 
        />
        
        <Route 
          path="/logs" 
          element={<LogsPage sessionId={sessionId} xsrfToken={xsrfToken}/>} 
        />
        
        <Route 
          path="/forgot-password" 
          element={<ForgotPassword />} 
        />
        
        <Route 
          path="/reset-password" 
          element={<ResetPassword />} 
        />

        <Route path='/settings' element={<Setting/>} />

        <Route 
          path="/logout" 
          element={<Logout setSessionId={setSessionId} sessionId={sessionId} xsrfToken={xsrfToken}/>} 
        />
      </Routes>
    </Router>
  );
};

export default App;

