import React, { useState, useEffect, useRef } from 'react';
import { GridComponent, ColumnsDirective, ColumnDirective, Page, Sort, Inject } from '@syncfusion/ej2-react-grids';
import {
    TextBoxComponent,
  } from "@syncfusion/ej2-react-inputs";
  import { FormValidator } from '@syncfusion/ej2-inputs';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './ManageFaces.css'; // You can reuse or modify this CSS
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout';
import DrawROIPopup from "./DrawROIPopup"


const ManageCameras = () => {
    const [cameraData, setCameraData] = useState([]);
    const [streamid, setStreamId] = useState('');
    const [streamname, setStreamName] = useState('');
    const [primarystream, setPrimaryStream] = useState('');
    const [secondarystream, setSecondaryStream] = useState('');
    const [mediaStreamPrimary, setMediaPrimaryStream] = useState('');
    const [mediaStreamSecondary, setMediaSecondaryStream] = useState('');
    const [rtspstream, setRtspStream] = useState('');
    const [analytictype, setAnalyticType] = useState([]);
    const [status, setStatus] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [xsrfToken, setXsrfToken] = useState("");
    const [errorMessage, setErrorMessage] = useState(null);
    const gridRef = useRef(null);
    const navigate = useNavigate();
    const [userData, setUserData] = useState(null);
    const formObject = React.useRef(null);
    const [showDrawPopup, setShowDrawPopup] = useState(false);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const serverIp = window.location.hostname;
    const storageKey = `activeStreams_${serverIp}`;

    useEffect(() => {
      const checkAuth = async () => {
        try {
          const authData = await ValidateAuth();
            if (!authData || !['User','Admin', 'SuperAdmin'].includes(authData.user.role)) {
                 navigate('/login');
            }
            else {
               const rights = authData.user.rights || {};
               const hasCameraPermissions = rights['Add Camera'] || rights['Delete Camera'];
               if (!hasCameraPermissions && authData.role !== 'SuperAdmin') {
                  navigate('/login');
               } else {
                   setUserData(authData.user);
               }
            }
        } catch (error) {
            console.error('Error validating auth:', error);
            navigate('/login');
        }
     };
     checkAuth();
   }, [navigate]); 

    useEffect(() => {
           async function setCSRFToken() {
               try {
                   const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getToken`, {
                       method: 'GET',
                       credentials: 'include', // Allow cookies to be sent with the request
                   });
   
                   if (response.ok) {
                       const csrfToken = response.headers.get('X-CSRF-Token');
                       setXsrfToken(csrfToken);;
                   } else {
                       setErrorMessage("Failed to fetch CSRF token from the server.");
                   }
               } catch (error) {
                   if (error instanceof TypeError) {
                       setErrorMessage("Failed to connect to the server. Please try again later.");
                   } else {
                       setErrorMessage("An unexpected error occurred while setting CSRF token.");
                   }
               }
           }
           setCSRFToken();
       }, []);

    // function getCsrfToken() {
    //     const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    //     return match ? match[1] : null;
    // }
    //const csrfToken = getCsrfToken();
    // Fetch existing camera data
    useEffect(() => {
        const fetchCameraData = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getCameras`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                });

                if (response.ok) {
                    const data = await response.json();
                    setCameraData(data.cameras);
                } else {
                    throw new Error('Failed to fetch camera data');
                }
            } catch (error) {
                console.error('Error:', error);
            }
        };
        fetchCameraData();
    }, []);

    useEffect(() => {
        if (gridRef.current) {
            //console.log('Updating Grid Data Source');
            gridRef.current.dataSource = cameraData;
        }
    }, [cameraData]);

    const analyticOptions = [
        { id: 'frs', label: 'FRS' },
        { id: 'intrusion', label: 'Intrusion' },
        { id: 'fire-detection', label: 'Fire Detection' },
        { id: 'train-stoppage', label: 'Train Stoppage' },
        { id: 'object-abandon', label: 'Object Abandon' },
        { id: 'crowd', label: 'Crowd' },

    ];

    const handleCheckboxChange = (e, value) => {
        // Ensure event and target are defined correctly
        const isChecked = e?.target?.checked ?? false;
    
        setAnalyticType((prev) => 
            isChecked 
            ? [...new Set([...prev, value])] // Avoid duplicates
            : prev.filter((item) => item !== value)
        );
    
        console.log(analytictype, "analytical type");
    };

    // Export camera data to PDF
    const exportAllGridDataToPDF = async () => {
        const data = cameraData || [];
        const doc = new jsPDF();

        const columns = [
            { header: 'Stream ID', dataKey: 'streamid' },
            { header: 'Stream Name', dataKey: 'streamname' },
            { header: 'Primary Stream', dataKey: 'primarystream' },
            { header: 'Secondary Stream', dataKey: 'secondarystream' },
            { header: 'Analytic Type', dataKey: 'analytictype' },
            { header: 'Status', dataKey: 'status' },
        ];

        const rows = data.map((row) => ({
            streamid: row.streamid,
            streamname: row.streamname,
            primarystream: row.primarystream,
            secondarystream: row.secondarystream,
            analytictype: row.analytictype,
            status: row.status ? 'Active' : 'Inactive',
        }));

        doc.autoTable({
            columns,
            body: rows,
            startY: 10,
        });

        doc.save('Cameras.pdf');
    };

    // Handle form submission to add a new camera
    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = {
            streamid,
            streamname,
            primarystream,
            secondarystream,
            rtspstream,
            mediaStreamPrimary,
            mediaStreamSecondary,
            analytictype,
            status,
        };
        console.log("camera")
        try {
        if (formObject.current.validate()) {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/addCamera`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': xsrfToken
                },
                body: JSON.stringify(formData),
                credentials: 'include',
            });

            if (response.ok) {
                const cameraData = await response.json();
                setCameraData((prevData) => [...prevData, cameraData.newCamera]);
                setStreamId('');
                setStreamName('');
                setPrimaryStream('');
                setSecondaryStream('');
                setRtspStream('');
                setMediaPrimaryStream('');
                setMediaSecondaryStream('');
                setAnalyticType([]);
                setStatus(true);
                // setShowForm(false); // Return to the table view
            } else {
                // throw new Error('Failed to add camera');
                let error = await response.json()
                console.log(error,"Errorssssssss")
                window.alert(error.message || 'Failed to add camera');
                setStreamId('');
                setStreamName('');
                setPrimaryStream('');
                setSecondaryStream('');
                setRtspStream('');
                setMediaPrimaryStream('');
                setMediaSecondaryStream('');
                setAnalyticType([]);
                setStatus(true);
            }
        }
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const deleteRow = async (streamid) => {
        try {
          const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/deleteCamera`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body:JSON.stringify({streamid}),
            credentials: 'include',
          });
          if(response.ok){
            setCameraData((prevData) => prevData.filter((row) => row.streamid !== streamid));
            const storedStreams = JSON.parse(localStorage.getItem(storageKey)) || [];
            const indexToRemove = streamid - 1;

            if (indexToRemove >= 0 && indexToRemove < storedStreams.length) {
                // Shift elements left
                for (let i = indexToRemove; i < storedStreams.length - 1; i++) {
                    storedStreams[i] = storedStreams[i + 1];
                }

                // Add null at the end to keep same length
                storedStreams[storedStreams.length - 1] = null;

                localStorage.setItem(storageKey, JSON.stringify(storedStreams));
            }
          }
        } catch (error) {
          console.error('Error deleting row:', error);
        }
    };

    const openDrawPopup = (cameraData) => {
        console.log(cameraData,"cameraData")
        setSelectedCamera(cameraData);
        setShowDrawPopup(true);
    };

    const closeDrawPopup = () => {
        setShowDrawPopup(false);
    };

    const saveROI = (roiCoordinates) => {
        console.log("Saved ROI coordinates:", roiCoordinates);
        // Save the ROI coordinates to your backend or database
        setShowDrawPopup(false);
    };

    const validationRules = {
        streamid: {
          required: [true, "Stream ID is required"],
          regex: [
            /^[a-zA-Z0-9]+$/,
            "Stream ID must be alphanumeric",
          ],
        },
        streamname: {
          required: [true, "Stream Name is required"],
          regex: [
            /^[a-zA-Z0-9@._-]+$/,
            "Stream Name can only contain letters, numbers, and special characters (@, ., _, -)",
          ],
        },
        primarystream: {
          required: [true, "Primary Stream is required"],
          regex: [
            /^(https?:\/\/|ftp:\/\/|rtsp:\/\/)([^\s]+)(:\d+)?(\/[^\s]*)?$/,
            "Primary Stream must be a valid URL starting with http, https, ftp, or rtsp",
          ],
        },
        secondarystream: {
          required: [true, "Secondary Stream is required"],
          regex: [
            /^(https?:\/\/|ftp:\/\/|rtsp:\/\/)([^\s]+)(:\d+)?(\/[^\s]*)?$/,
            "Secondary Stream must be a valid URL starting with http, https, ftp, or rtsp",
          ],
        },
        
    };  

    const canAddCamera = userData?.rights?.['Add Camera'];
    const canDeleteCamera = userData?.rights?.['Delete Camera'] || userData?.role === 'SuperAdmin';
    const isSuperAdmin = userData?.role === 'SuperAdmin'; 
    return (
    <Layout>
        <div>
            <header className="header-menu">
                <Menu />
            </header>
            {!showForm ? (
                <div className="cameraTableContainer">
                    <h2>Manage Cameras</h2>
                    <GridComponent
                        ref={gridRef}
                        dataSource={cameraData}
                        allowPaging={true}
                        allowSorting={true}
                        pageSettings={{ pageSize: 5 }}
                    >
                        <ColumnsDirective>
                            <ColumnDirective field="streamid" headerText="Stream ID" width="150" textAlign="Center" />
                            <ColumnDirective field="streamname" headerText="Stream Name" width="200" textAlign="Center" />
                            <ColumnDirective
                                field="primarystream"
                                headerText="Primary Stream"
                                width="250"
                                textAlign="Center"
                            />
                            <ColumnDirective
                                field="secondarystream"
                                headerText="Secondary Stream"
                                width="250"
                                textAlign="Center"
                            />
                            
                            <ColumnDirective
                                field="rtspstream"
                                headerText="RTSP Stream"
                                width="250"
                                textAlign="Center"
                            />
                            
                            <ColumnDirective
                                field="analytictype"
                                headerText="Analytic Type"
                                width="250"
                                textAlign="Center"
                                template={(rowData) => (
                                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
                                        {rowData.analytictype.map((type, index) => (
                                            <div key={index} style={{ display: "flex", alignItems: "center", padding: "5px" }}>
                                                <i
                                                    className="fa fa-check"
                                                    style={{ color: "green", marginRight: "5px" }}
                                                    aria-hidden="true"
                                                ></i>
                                                <span>{type}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            />
                            <ColumnDirective
                                field="status"
                                headerText="Status"
                                width="100"
                                textAlign="Center"
                                template={(rowData) =>
                                    rowData.status ? <span style={{ color: 'green' }}>Active</span> : <span>Inactive</span>
                                }
                            />
                            {canDeleteCamera && (
                            <ColumnDirective 
                                headerText='Actions' 
                                width='120' 
                                height='50'
                                textAlign="Center" 
                                template={(rowData) => (
                                 // canDeleteCamera || isSuperAdmin ? (
                                    <div>
                                        <button 
                                            onClick={() => deleteRow(rowData.streamid)} 
                                            style={{ 
                                            background: 'none', 
                                            border: 'none', 
                                            cursor: 'pointer', 
                                            color: 'red', 
                                            fontSize: '18px' 
                                            }}
                                            title="Delete"
                                        >
                                            <i className="fa fa-trash" aria-hidden="true"></i>
                                        </button>
                                        <button 
                                            onClick={() => openDrawPopup(rowData)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'blue', fontSize: '18px', marginTop: '2px' }} 
                                            title="Draw ROI"
                                        >
                                            <i className="fa fa-pencil" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                // ):null
                                )}
                            />
                           )}
                        </ColumnsDirective>
                        <Inject services={[Page, Sort]} />
                    </GridComponent>
                    <div className="button-container">
                        {cameraData.length ? (
                            <button type="button" className="exportPdfButton" onClick={exportAllGridDataToPDF}>
                                Export to PDF
                            </button>
                        ) : null}
                        {canAddCamera || isSuperAdmin ? (
                          <button type="button" className="addCameraButton" onClick={() => setShowForm(true)}>
                              Add Camera
                          </button>
                        ):null}
                    </div>
                    {showDrawPopup && (
                        <DrawROIPopup
                            cameraData={selectedCamera}
                            onClose={closeDrawPopup}
                            onSaveROI={saveROI}
                            open={showDrawPopup}
                        />
                    )}
                </div>
            ) : (
                <div className="addCameraFormContainer">
                    <h2>Add Camera Form</h2>
                    <form
                        onSubmit={handleSubmit}
                        ref={(form) => {
                            //if (form && !formObject.current) {
                            console.log(form,formObject.current,"console")
                            formObject.current = new FormValidator(form, {
                                rules: validationRules,
                            });
                            //}
                        }}
                    >
                        <div>
                            <label htmlFor="streamid">Stream ID:</label>
                            <TextBoxComponent
                                id="streamid"
                                value={streamid}
                                change={(e) => setStreamId(e.value)}
                                placeholder="Enter Stream ID"
                                cssClass="camera_field"
                            />
                        </div>

                        <div>
                            <label htmlFor="streamname">Stream Name:</label>
                            <TextBoxComponent
                                id="streamname"
                                value={streamname}
                                change={(e) => setStreamName(e.value)}
                                placeholder="Enter Stream Name"
                                cssClass="camera_field"
                            />
                        </div>

                        <div>
                            <label htmlFor="primarystream">Primary Stream URL:</label>
                            <TextBoxComponent
                                id="primarystream"
                                value={primarystream}
                                change={(e) => setPrimaryStream(e.value)}
                                placeholder="Enter Primary Stream URL"
                                cssClass="camera_field"
                            />
                        </div>

                        <div>
                            <label htmlFor="secondarystream">Secondary Stream URL:</label>
                            <TextBoxComponent
                                id="secondarystream"
                                value={secondarystream}
                                change={(e) => setSecondaryStream(e.value)}
                                placeholder="Enter Secondary Stream URL"
                                cssClass="camera_field"
                            />
                        </div>
                        
                        <div>
                            <label htmlFor="rtspstream">RTSP Stream URL:</label>
                            <TextBoxComponent
                                id="rtspstream"
                                value={rtspstream}
                                change={(e) => setRtspStream(e.value)}
                                placeholder="Enter RTSP Stream URL"
                                cssClass="camera_field"
                            />
                        </div>

                        <div>
                            <label htmlFor="mediastreamPrimary">Mediaserver Primary URL:</label>
                            <TextBoxComponent
                                id="mediastreamPrimary"
                                value={mediaStreamPrimary}
                                change={(e) => setMediaPrimaryStream(e.value)}
                                placeholder="Enter Mediaserver Primary URL"
                                cssClass="camera_field"
                            />
                        </div>

                        <div>
                            <label htmlFor="mediastreamSecondary">Mediaserver Secondary URL:</label>
                            <TextBoxComponent
                                id="mediastreamSecondary"
                                value={mediaStreamSecondary}
                                change={(e) => setMediaSecondaryStream(e.value)}
                                placeholder="Enter Mediaserver Secondary URL"
                                cssClass="camera_field"
                            />
                        </div>
                        
{/*
                        <div>
                            <label>Analytic Type:</label>
                            {analyticOptions.map((option) => (
                                <div key={option.id} className='analytic_types' style={{display:"inline-block",padding:"0px 3px"}}>
                                    <label htmlFor={option.id} style={{display:"inline-block"}}>{option.label}</label>
                                    <input
                                        type="checkbox"
                                        id={option.id}
                                        value={option.id}
                                        checked={analytictype.includes(option.id)}
                                        onChange={(e) => handleCheckboxChange(e, option.id)}
                                    />
                                </div>
                            ))}
                        </div>
*/}
                        <div>
                            <label htmlFor="status">Status:</label>
                            <select
                                id="status"
                                value={status}
                                onChange={(e) => setStatus(e.target.value === 'true')}
                                required
                            >
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                            </select>
                        </div>
                        <button type="submit">Submit</button>
                        <button type="button" onClick={() => setShowForm(false)}>
                            Show Table
                        </button>
                    </form>
                </div>
            )}
         
        </div>
        </Layout>
    );
};

export default ManageCameras;
