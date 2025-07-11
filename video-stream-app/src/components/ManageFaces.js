import React, { useState, useEffect, useRef } from 'react';
import { GridComponent, ColumnsDirective, ColumnDirective, Page, Sort, Inject} from '@syncfusion/ej2-react-grids';
import { FormValidator } from '@syncfusion/ej2-inputs';
import { decode, isMultiPage, pageCount, tagNames } from 'tiff';

//console.log(TiffModule,"tiff");

import {
  TextBoxComponent,
} from "@syncfusion/ej2-react-inputs";
import { ButtonComponent } from "@syncfusion/ej2-react-buttons";
import imageCompression from 'browser-image-compression';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './ManageFaces.css';
import jsPDF from "jspdf";
import "jspdf-autotable";
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import 'font-awesome/css/font-awesome.min.css'; 
import JSZip from "jszip";
import { useLocation } from 'react-router-dom';
//import Footer from './Footer';
import Layout from './Layout';


const ManageFaces = () => {
const location = useLocation();
const [enhanceFace, setEnhanceFace] = useState(false); // Add this at top

  const [compressionProgress, setCompressionProgress] = useState(0); // Progress for compression
  const [uploadProgress, setUploadProgress] = useState(0); // Progress for uploading
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSinglePerson, setIsSinglePerson] = useState(false);
const [age, setAge] = useState('');
const [sex, setSex] = useState('');
const [isProcessing, setIsProcessing] = useState(false);
const [showAddForm, setShowAddForm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ name: "", threshold: "", remark: "" });
const [selectedGroup, setSelectedGroup] = useState("");
  
  const [facesData, setFacesData] = useState([]);
  const [personName, setPersonName] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState('whitelist');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [showForm, setShowForm] = useState(false);
  const [fromDate, setFromDate] = useState();
  const [toDate, setToDate] = useState();
  const [findPersonName, setFindPersonName] = useState("");
  const gridRef = useRef(null);
  const [xsrfToken, setXsrfToken] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const defaultImage = "/assets/defaultImage.png";
  const [folderPath, setFolderPath] = useState("");
  const [isMultiple, setIsMultiple] = useState(false);

  const navigate = useNavigate();
  const [userData, setUserData] = useState(null)
  const formRef = useRef(null);
const formObject = useRef(null);

useEffect(() => {
  if (!location.state || !location.state.croppedImage) {
    setImageBase64('');
  }
}, []);

 useEffect(() => {
  if (location.state?.croppedImage) {
    setShowForm(true);
    setIsMultiple(false);
    setImageBase64(location.state.croppedImage);
    navigate(location.pathname, { replace: true }); // Clear location.state
  }
}, [location.state]);

console.log(imageBase64,"image64")

useEffect(() => {
  if (formRef.current) {
    // Destroy old validator
    if (formObject.current) {
      formObject.current.destroy();
    }

    // Create a new validator with updated rules
    formObject.current = new FormValidator(formRef.current, {
      rules: getValidationRules(isMultiple, isSinglePerson),
    });
  }
}, [isMultiple, isSinglePerson]);

  
  useEffect(() => {
      const checkAuth = async () => {
          try {
              const authData = await ValidateAuth();
              if (!authData || !['User','Admin', 'SuperAdmin'].includes(authData.user.role)) {
                  navigate('/login');
              }
              else {
                  const rights = authData.user.rights || {};
                  const hasCameraPermissions = rights['Add Face'] || rights['Delete Face'];

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
  //   const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  //   return match ? match[1] : null;
  // }
  //const csrfToken = getCsrfToken();
  
  useEffect(() => {
    // Fetch categories from backend
    const fetchCategories = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/categories`);
        const data = await response.json();
        setCategories(data);
      } catch (error) {
        console.error("Error fetching categories:", error);
      }
    };
    fetchCategories();
  }, []);

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmitCategory = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error("Failed to add category");
      }

      const newCategory = await response.json();
      setCategories((prev) => [...prev, newCategory]); // Add to dropdown
      setForm({ name: "", threshold: "", remark: "" }); // Reset form
      setShowAddForm(false); // Hide form
    } catch (error) {
      console.error("Error submitting category:", error);
    }
  };

  

  const exportAllGridDataToPDF = async (gridRef) => {
    if (!gridRef.current) return;

    const data = gridRef.current.dataSource || [];
    const doc = new jsPDF();

    const columns = [
        { header: "Person Id", dataKey: "id" },
        { header: "Person Name", dataKey: "name" },
        { header: "Type", dataKey: "type" },
        { header: "Remark", dataKey: "remark" },
        { header: "Date", dataKey: "date" },
        { header: "Group", dataKey: "group_name" },
        { header: "Image", dataKey: "image" }
    ];

    // Prepare rows
    const rows = data.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        remark: row.remark,
        date: row.date,
        group_name: row.group_name || 'N/A',
        image: " "
    }));
    doc.autoTable({
        columns,
        body: rows,
        didDrawCell: (cellData) => {
          if (cellData.column.dataKey === "image" && cellData.cell.raw && cellData.cell.section === 'body') {
                const rowIndex = cellData.row.index; // row.index gives the index of the current row
                const imgData = data[rowIndex].image;

                if (imgData) {
                  cellData.cell.text = [];
                  cellData.cell.raw = "";
                  cellData.cell.styles.fontSize = 0;

                    // Calculate dimensions for the image to fit within the cell
                    const cellWidth = cellData.cell.width - 2;
                    const cellHeight = cellData.cell.height - 2;

                    // Draw the image within the cell bounds
                    doc.addImage(imgData, "JPEG", cellData.cell.x, cellData.cell.y, cellWidth, cellHeight);
                }
            }
        },
        startY: 10,
    });

    doc.save("ManageFacesPDF.pdf");
  };

  useEffect(() => {
  const socket = new WebSocket(`${process.env.REACT_APP_WEBSOCKET_URL}`);

  // Fetch data initially
  const fetchFacesData = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getPersonsData`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDate, toDate, findPersonName }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
    } catch (err) {
      console.error('Error fetching face data:', err);
    }
  };

  fetchFacesData();
  console.log("📡 Initial face data fetched");

  socket.onopen = () => {
    console.log('🟢 WebSocket connected');
  };

  socket.onmessage = (event) => {
  try {
    const outerResult = JSON.parse(event.data);

    if (outerResult?.type === "faceAlert") {
      const innerResult = outerResult.data;

      if (innerResult?.Event === "SimilarFaceDetected") {
        setIsProcessing(false);
        alert(innerResult.Message);
      }
    }

    if (outerResult?.type === "faceSaved") {
      const innerResult = outerResult.data;

      setIsProcessing(false); // stop loading
      alert(innerResult?.Message || "Face saved successfully.");
    }

    if (outerResult.type === "personData") {
      const innerResult = JSON.parse(outerResult.data);
      setFacesData([...innerResult]);
    }

  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
};
;

  socket.onerror = (error) => {
    console.error("⚠️ WebSocket error:", error);
  };

  socket.onclose = () => {
    console.log("🔴 WebSocket disconnected");
  };

  return () => {
    socket.close();
  };
}, []);

  
  useEffect(() => {
        if (gridRef.current) {
            console.log('Updating Grid Data Source');
            gridRef.current.dataSource = facesData;
        }
    }, [facesData]);

const convertToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = () => {
      const base64Data = reader.result.split(",")[1]; // Strip metadata
      resolve(base64Data);
    };

    reader.onerror = (error) => reject(error);
  });
};

// Convert TIFF/BMP to PNG using canvas
const convertUnsupportedImageToPng = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (event) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/png", 1);
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Compress image using imageCompression
const compressImage = async (file) => {
  const options = {
    maxSizeMB: 0.2,
    maxWidthOrHeight: 600,
    quality: 0.1,
    useWebWorker: true,
  };
  return await imageCompression(file, options);
};

const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) {
        console.error("No file selected");
        return;
    }

    if (location.state?.croppedImage && imageBase64 === location.state.croppedImage) {
        console.log("Preloaded image in use, skipping file input.");
        return;
    }

    if (file.name.match(/\.(zip|rar|7z)$/i)) {
        const compressedFile = await compressFolder(file);
        const base64Compressed = await convertToBase64(compressedFile);
        setImageBase64(base64Compressed);
        return;
    }

    const fileType = file.type;

    try {
        let finalBase64 = "";

        if (fileType === "image/tiff" || file.name.endsWith(".tiff") || file.name.endsWith(".tif")) {
            console.log("TIFF detected — converting manually");
            finalBase64 = await convertTiffToBase64PNG(file); // New function
        } else {
            const options = { maxSizeMB: 0.2, maxWidthOrHeight: 600, quality: 0.2 };
            const compressedFile = await imageCompression(file, options);
            finalBase64 = await convertToBase64(compressedFile);
        }

        setImageBase64(finalBase64);
    } catch (err) {
        console.error("Error processing file:", err);
    }
};

const convertTiffToBase64PNG = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file); // Read file as ArrayBuffer

        reader.onload = () => {
            try {
                const arrayBuffer = reader.result;
                console.log('ArrayBuffer:', arrayBuffer);
                console.log("First few bytes of ArrayBuffer:", new Uint8Array(arrayBuffer).slice(0, 20));

                if (!arrayBuffer) {
                    console.error("Error: ArrayBuffer is empty.");
                    return;
                }

                // Decode the TIFF file
                const tiffData = decode(arrayBuffer);
                console.log("Decoded TIFF data:", tiffData);

                if (tiffData.length > 0) {
                    const tiffImage = tiffData[0]; // Access the first TIFF image data
                    console.log("TIFF Image Data:", tiffImage);

                    // Convert RGB to RGBA (Canvas requires 4 bytes per pixel)
                    const rgbData = tiffImage.data;
                    const rgbaData = new Uint8ClampedArray(tiffImage.width * tiffImage.height * 4);

                    for (let i = 0, j = 0; i < rgbData.length; i += 3, j += 4) {
                        rgbaData[j] = rgbData[i];         // R
                        rgbaData[j + 1] = rgbData[i + 1]; // G
                        rgbaData[j + 2] = rgbData[i + 2]; // B
                        rgbaData[j + 3] = 255;            // A
                    }

                    // Create ImageData object
                    const imageData = new ImageData(rgbaData, tiffImage.width, tiffImage.height);
                    console.log("ImageData:", imageData);

                    // Create canvas and draw image
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = tiffImage.width;
                    canvas.height = tiffImage.height;
                    ctx.putImageData(imageData, 0, 0);

                    // Convert to Base64 PNG
                    const pngBase64 = canvas.toDataURL("image/png").split(",")[1];
                    resolve(pngBase64);
                } else {
                    console.error("No TIFF image data found.");
                    reject("Error: No valid TIFF image data found.");
                }

            } catch (err) {
                console.error("Error processing TIFF:", err);
                reject(`Error processing TIFF: ${err.message}`);
            }
        };

        reader.onerror = (err) => {
            reject(`FileReader error: ${err.message}`);
        };
    });
};



// Function to compress folder and return as Base64
  const compressFolder = async (file) => {
    const zip = new JSZip();
    const newZip = new JSZip();
    setIsCompressing(true);
    setCompressionProgress(0);

    try {
        const extractedFiles = await zip.loadAsync(file);
        const fileNames = Object.keys(extractedFiles.files).filter(name => !extractedFiles.files[name].dir); // Skip directories
        const totalFiles = fileNames.length;
        let processedFiles = 0;

        for (const fileName of fileNames) {
            const fileData = await extractedFiles.files[fileName].async("blob");
            const fileType = fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? `image/${fileName.split('.').pop()}` : '';

            if (fileType.startsWith("image/")) { 
                try {
                    const correctedBlob = new Blob([fileData], { type: fileType });
                    const compressedImage = await compressImage(correctedBlob);
                    newZip.file(fileName, compressedImage);
                } catch (imageError) {
                    console.warn(`Skipping ${fileName}: Not a valid image.`);
                    newZip.file(fileName, fileData);
                }
            } else {
                newZip.file(fileName, fileData);
            }

            processedFiles++;
            setCompressionProgress((processedFiles / totalFiles) * 100); 
        }

        const compressedBlob = await newZip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 9 },
        });

        console.log(`Original Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Compressed Size: ${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`);

        setIsCompressing(false);
        return compressedBlob;
    } catch (error) {
        console.error("Error compressing folder:", error);
        setIsCompressing(false);
    }
};

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!imageBase64) {
        console.error("No file selected");
        return;
    }

    const payload = {
        isMultiple: isMultiple,
        isSinglePerson: isSinglePerson,
        Type: status,
        GroupName: selectedGroup,
        Remark: remarks || "Default Remark",
    };

    // Handle different cases
    if (isMultiple) {
        payload.compressedFolder = imageBase64;

        // If it's a single person upload with multiple images, include personal details
        if (isSinglePerson) {
            payload.PersonName = personName;
            payload.Age = age;
            payload.Sex = sex;
        }
    } else {
        // Single image upload
        payload.PersonName = personName;
        payload.Image = imageBase64;
        payload.Age = age;
        payload.Sex = sex;
        payload.enhanceFace = enhanceFace ? "yes" : "no";
    }

    try {
        setIsUploading(true);
        setUploadProgress(0);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${process.env.REACT_APP_SERVER_URL}/uploadFace`, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("X-CSRF-Token", xsrfToken);

        // Track upload progress
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                setUploadProgress(percentComplete);
            }
        };
        setIsProcessing(true);

        xhr.onload = () => {
            if (xhr.status === 200) {
                console.log("Upload complete!", xhr.responseText);
                // Clear all fields
                setPersonName("");
                setAge("");
                setSex("");
                setImageBase64("");
                setRemarks("");
                setStatus("whitelist");
                setSelectedGroup("");
                setIsSinglePerson(false);
                setUploadProgress(0);
            } else {
                console.error("Upload failed", xhr.responseText);
            }
            setIsUploading(false);
        };

        xhr.onerror = () => {
            console.error("Error uploading file");
            setIsUploading(false);
        };

        xhr.send(JSON.stringify(payload));
    } catch (err) {
        console.error("Error:", err);
        setIsUploading(false);
    }
};

  
  const handleFind = async () => {
    if ((fromDate && toDate) || (!fromDate && !toDate && findPersonName)) {
      try {
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getPersonsData`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromDate, toDate, findPersonName }),
        });

        if (response.ok) {
          await response.json();
        } else {
          throw new Error('Failed to fetch data. Please try again.');
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    } else {
      alert('Please Enter Information Correctly');
    }
  };


  const deleteRow = async (id,name) => {
    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body:JSON.stringify({id,name}),
        credentials: 'include',
      });
      setFacesData((prevData) => prevData.filter((row) => row.id !== id));
    } catch (error) {
      console.error('Error deleting row:', error);
    }
  };

  // const handleFolderSelect = async (e) => {
  //   if (e.target.files.length > 0) {
  //     const firstFilePath = e.target.files[0].webkitRelativePath;
  //     const extractedFolder = firstFilePath.split("/")[0];
  //     console.log(extractedFolder)
  //     setFolderPath(extractedFolder);
  //   }
  // };
  
  useEffect(() => {
  if (formRef.current) {
    // Clean up previous validator
    if (formObject.current) {
      formObject.current.destroy();
    }

    // Initialize with current rules
    formObject.current = new FormValidator(formRef.current, {
      rules: getValidationRules(isMultiple, isSinglePerson),
    });
  }
}, [isMultiple, isSinglePerson]);


// This is clearer and ensures the rules match the visible fields

const getValidationRules = (isMultiple, isSinglePerson) => {
  const rules = {
    remarks: { maxLength: [500, "Remarks must not exceed 500 characters"] },
    group: {
      required: [true, "Group is required"],
      regex: [/^[a-zA-Z0-9\s]+$/, "Group can only contain letters, numbers, and spaces"],
    },
    status: {
      required: [true, "Status is required"],
      in: [["whitelist", "blacklist"], "Status must be either 'whitelist' or 'blacklist'"],
    },
  };

  if (isMultiple) {
    rules.folderPath = { required: [true, "Folder path is required"] };

    if (isSinglePerson) {
      rules.personName = {
        required: [true, "Person Name is required"],
        regex: [/^[a-zA-Z0-9\s]+$/, "Person Name can only contain letters, numbers, and spaces"],
      };
    }
  } else {
    rules.image = { required: [true, "Image is required"] };
    rules.personName = {
      required: [true, "Person Name is required"],
      regex: [/^[a-zA-Z0-9\s]+$/, "Person Name can only contain letters, numbers, and spaces"],
    };
  }

  return rules;
};

  

  const canAddFace = userData?.rights?.['Add Face'];
  const canDeleteFace = userData?.rights?.['Delete Face'] || userData?.role === 'SuperAdmin';
  const isSuperAdmin = userData?.role === 'SuperAdmin';

  return (
   <Layout>
    <div>
      <header className="header-menu">
        <div>
          <Menu />
        </div>
      </header>
      {!showForm ? (
        <div className='facesTableContainer'>
          <h2>Manage Faces</h2>
          <div className="filters">
          {
          /*
            <div className="filter-item">
              <label className="filter-label">From:</label>
              <DatePicker
                selected={fromDate}
                onChange={(date) => setFromDate(date)}
                className="filter-input"
                placeholderText="Select From Date"
                showYearDropdown
                dropdownMode="select" 
              />
            </div>

            <div className="filter-item">
              <label className="filter-label">To:</label>
              <DatePicker
                selected={toDate}
                onChange={(date) => setToDate(date)}
                className="filter-input"
                placeholderText="Select To Date"
                showYearDropdown
                dropdownMode="select" 
              />
            </div>
           

            <div className="filter-item">
              <label className="filter-label">Name:</label>
              <input 
                type="text" 
                value={findPersonName} 
                onChange={(e) => setFindPersonName(e.target.value)} 
                placeholder="Enter Name"
                className="filter-input"
              />
            </div>
            

            <button className="filter-button" onClick={() => handleFind()}>Find</button>
              */
              }
          </div>

          <GridComponent 
            ref={gridRef} 
            dataSource={facesData} 
            allowPaging={true} 
            allowSorting={true} 
           pageSettings = {{pageSize:itemsPerPage, currentPage:currentPage,pageCount:20,totalRecordsCount:facesData.length}}
          >
            <ColumnsDirective>
              <ColumnDirective field='id' headerText='Person Id' width='120' textAlign="Center" />
              <ColumnDirective field='name' headerText='Person Name' width='150' textAlign="Center" />
              <ColumnDirective field='type' headerText='Type' width='100' textAlign="Center" />
              <ColumnDirective field='remark' headerText='Remark' width='150' textAlign="Center" />
              <ColumnDirective field='date' headerText='Date' width='120' textAlign="Center" />
              <ColumnDirective 
                field='group'
                headerText='Group' 
                width='120' 
                textAlign="Center" 
                template={(rowData) => rowData.group_name ? rowData.group_name : 'N/A'}
              />
                <ColumnDirective 
    headerText='Gender' 
    width='100' 
    textAlign="Center" 
    template={(rowData) => rowData.sex || 'N/A'} 
  />

  {/* Age Column */}
  <ColumnDirective 
    headerText='Age' 
    width='80' 
    textAlign="Center" 
    template={(rowData) => rowData.age || 'N/A'} 
  />
              <ColumnDirective
                field='image'
                headerText='Image'
                width='100'
                template={(rowData) => (
                  <img src= {rowData.image? `data:image/jpeg;base64,${rowData.image}`:defaultImage} alt='Uploaded Person Pic' width={50} />
                )}
                textAlign="Center"
              />
              {canDeleteFace && (
              <ColumnDirective 
                headerText='Actions' 
                width='120' 
                height='50'
                textAlign="Center" 
                template={(rowData) => (
                 // canDeleteFace || isSuperAdmin  ? (
                  <button 
                    onClick={() => deleteRow(rowData.id,rowData.name)} 
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
                // ) : null
                )}
              />
            )}
            </ColumnsDirective>
            <Inject services={[Page,Sort]} />
          </GridComponent>

          <div className='button-container'>
          {facesData.length? 
            (<button type='button' className='exportPdfButton' onClick={() => exportAllGridDataToPDF(gridRef)}>Export to PDF</button>)
            :
            (<></>) 
          }
            {canAddFace || isSuperAdmin ? (
            <button  type = "button" className = "addFaceButton" onClick={() => setShowForm(true)}>Add Face</button>
            ): null}
          </div>
        </div>
      ) : 
      (
        <div className='addFace-app-container'>
  <h2>Add Face Form</h2>

  <form onSubmit={handleSubmit}>

    {/* Toggle for multiple image uploads */}
    <div style={{ display: "flex", columnGap: "5px", fontSize: "large" }}>
     <input
  type="checkbox"
  id="isMultiple"
  name="isMultiple"
  checked={isMultiple}
  onChange={(e) => setIsMultiple(e.target.checked)}
  disabled={!!imageBase64} // Disable if we came from cropped image
/>
      <label htmlFor="isMultiple">Upload Multiple Images?</label>
    </div>

    {/* Show single person checkbox only if isMultiple is checked */}
    {isMultiple && (
      <div style={{ display: "flex", columnGap: "5px", fontSize: "large" }}>
        <input type="checkbox" id="isSinglePerson" name="isSinglePerson" checked={isSinglePerson} onChange={(e) => setIsSinglePerson(e.target.checked)} />
        <label htmlFor="isSinglePerson">Are These Images of a Single Person?</label>
      </div>
    )}

    {/* Enable fields only if it's not multiple or it's multiple + single person */}
    {(!isMultiple || (isMultiple && isSinglePerson)) && (
      <>
        <div>
          <label htmlFor="personName">Person Name:</label>
          <input name="personName" value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Enter Person Name" />
        </div>

        {/* Age field */}
        <div>
          <label htmlFor="age">Age:</label>
          <input type="number" name="age" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Enter Age" />
        </div>

        {/* Sex field */}
        <div>
          <label htmlFor="sex">Gender:</label>
          <select name="sex" value={sex} onChange={(e) => setSex(e.target.value)}>
            <option value="">Select Gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </>
    )}

    {/* File input section */}
    <div>
      <label htmlFor="image">
        {isMultiple ? "Upload Compressed Folder (ZIP):" : "Upload Image:"}
      </label>
      <input
        type="file"
        id="image"
        name={isMultiple ? "folderPath" : "image"}
        accept={isMultiple ? ".zip" : "image/*"}
        onChange={handleFileChange}
      />
    </div>
    {!isMultiple && (
  <div style={{ marginTop: "10px" }}>
    <input
      type="checkbox"
      id="enhanceFace"
      checked={enhanceFace}
      onChange={(e) => setEnhanceFace(e.target.checked)}
    />
    <label htmlFor="enhanceFace" style={{ marginLeft: "5px" }}>
      Enhance Image
    </label>
  </div>
)}


    {isCompressing && (
      <div className="progress-bar">
        <label>Compressing Images: {compressionProgress.toFixed(2)}%</label>
        <progress value={compressionProgress} max="100"></progress>
      </div>
    )}

    {isUploading && (
      <div className="progress-bar">
        <label>Uploading: {uploadProgress.toFixed(2)}%</label>
        <progress value={uploadProgress} max="100"></progress>
      </div>
    )}

    {/* Remarks field (shown for both normal and single person multi-upload) */}
    {(!isMultiple || (isMultiple && isSinglePerson)) && (
      <div>
        <label htmlFor="remarks">Remarks:</label>
        <textarea name="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter Remarks" />
      </div>
    )}

    {/* Group selection */}
    <div>
      {/* Group selection */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <label htmlFor="group">Group:</label>
        <select
          id="group"
          name="group"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
        >
          <option value="">Select a value</option>
          {categories.map((cat) => (
            <option key={cat._id} value={cat.name}>
              {cat.name}
            </option>
          ))}
        </select>

        <button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? "Cancel" : "Add Category"}
        </button>
      </div>

      {/* Add Category Form */}
      {showAddForm && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input
            type="text"
            name="name"
            placeholder="Category Name"
            value={form.name}
            onChange={handleFormChange}
            required
          />
          <input
            type="number"
            name="threshold"
            placeholder="Threshold"
            value={form.threshold}
            onChange={handleFormChange}
            required
          />
          <input
            type="text"
            name="remark"
            placeholder="Remark"
            value={form.remark}
            onChange={handleFormChange}
            required
          />
          <button
  type="button"
  onClick={(e) => {
    e.preventDefault(); // Prevents triggering form onSubmit
    handleSubmitCategory();
  }}
>
  Submit Category
</button>
        </div>
      )}
    </div>

    {/* Type: whitelist / blacklist */}
    <div>
      <label>Type:</label>
      <div className="radioBox-container">
        <input type="radio" id="whitelist" name="status" value="whitelist" checked={status === "whitelist"} onChange={() => setStatus("whitelist")} />
        <label htmlFor="whitelist">Whitelist</label>
      </div>
      <div className="radioBox-container">
        <input type="radio" id="blacklist" name="status" value="blacklist" checked={status === "blacklist"} onChange={() => setStatus("blacklist")} />
        <label htmlFor="blacklist">Blacklist</label>
      </div>
    </div>

    {/* Buttons */}
    <ButtonComponent type="submit" cssClass="e-secondary">Submit</ButtonComponent>
    <ButtonComponent type="button" onClick={() => setShowForm(false)} cssClass="e-secondary">Show Table</ButtonComponent>
  </form>
  {isProcessing && (
      <div className="loader-overlay">
        <div className="loader">Processing...</div>
      </div>
    )}
</div>

      )}
    </div>
      </Layout>
  );
};

export default ManageFaces;
