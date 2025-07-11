import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from "react-router-dom"; 
import { useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { GridComponent, ColumnsDirective, ColumnDirective, Sort, Inject} from '@syncfusion/ej2-react-grids';
import DatePicker from 'react-datepicker';
import { Dialog, Tab, Tabs, Box } from "@mui/material";
import { Visibility } from "@mui/icons-material";
import 'react-datepicker/dist/react-datepicker.css';
import "./DetectFacesReport.css";
import jsPDF from "jspdf";
import "jspdf-autotable";
import Pagination from './Pagination';
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';

const DetectFacesReport = () => {
 const location = useLocation(); // To access the location object
  const { data } = location.state || {};
const [searchParams] = useSearchParams();

  const [fromDate, setFromDate] = useState(new Date(new Date().setDate(new Date().getDate() - 1))); // Yesterday
  const [toDate, setToDate] = useState(new Date(new Date().setDate(new Date().getDate() + 1))); // Tomorrow
  const [selectedGender, setSelectedGender] = useState(data?.gender || searchParams.get("gender") || '');
  const [selectedColor, setSelectedColor] = useState(data?.color || searchParams.get("color") || '');
  const [detectedData, setDetectedData] = useState([]);
  const [itemsPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [personName, setPersonName] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [dirr, setDirr] = useState('');
  const gridRef = useRef(null);
  const defaultImage = "/assets/defaultImage.png";
  const [selectedEvent, setSelectedEvent] = useState('');
  const [selectedAge, setSelectedAge] = useState("");
  const [selectedView, setSelectedView] = useState("");
  const [selectedBag, setSelectedBag] = useState("");
  const [selectedSleeves, setSelectedSleeves] = useState("");
  const [selectedUpperBody, setSelectedUpperBody] = useState("");
  const [selectedLowerBody, setSelectedLowerBody] = useState("");

  const [includePerson, setIncludePerson] = useState(false);
  const [includeVehicle, setIncludeVehicle] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [openModal, setOpenModal] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  
   useEffect(() => {
    if (data) {
      // If data exists, set the gender, color, and detected data
      setSelectedGender(data.gender || '');
      setSelectedColor(data.color || '');
     
    }
  }, [data]);
  
  const navigate = useNavigate();
  useEffect(() => {
      const checkAuth = async () => {
          const authData = await ValidateAuth();
          if (!authData) {
              navigate('/login');
          }
      };
      checkAuth();
  }, []);
  
  useEffect(() => {
    if (selectedGender || selectedColor) {
    console.log("Enter in useEffect")
      fetchData(currentPage);
    }
  }, [selectedGender, selectedColor, fromDate, toDate]);

 const fetchData = async (page) => {
  if ((fromDate && toDate) || (!fromDate && !toDate)) {
    try {
      setLoading(true);

      // Ensure Full ISO Format for Dates
      const formattedFromDate = fromDate ? new Date(fromDate).toISOString() : null;
      const formattedToDate = toDate ? new Date(toDate).toISOString() : null;

      // Convert IncludePerson & IncludeVehicle to EntityType Array
      const entityType = [];
      if (includePerson) entityType.push("person");
      if (includeVehicle) entityType.push("vehicle");

      // Fetch Data
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getVaDetectFacesReport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formattedFromDate,
          formattedToDate,
          page,
          age: selectedAge,
          view: selectedView,
          bag: selectedBag,
          sleeves: selectedSleeves,
          upperBody: selectedUpperBody,
          lowerBody: selectedLowerBody,
          color: selectedColor,
          gender: selectedGender,
          eventType: selectedEvent,
          entityType,
        }),
        credentials: "include",
      });

      if (response.ok) {
        let result = await response.json();
        console.log(result);
        setDetectedData(result.records);
        setTotalCount(result.totalRecords);
      } else {
        throw new Error("Failed to fetch data. Please try again.");
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  } else {
    alert("Please Enter Required Information.");
  }
};
  
  const handleOpenModal = (rowData) => {
    setSelectedRow(rowData);
    setOpenModal(true);
    setActiveTab(0);
  };
  
  const handleCloseModal = () => {
    setOpenModal(false);
    setSelectedRow(null);
    setVideoUrl(null);
    //setActiveTab(0);
  };

  const eventMap = {
    Loitering_Detected:"Loitering",
    Crowd_Formation_Detected:"Crowd-Formation",
    Crowd_Estimation_Detected:"Crowd-Estimation",
    Crowd_Dispersion_Detected:"Crowd-Dispersion",
    Intrusion_Detected:"Intrusion",
    Waving_Detected:"Waving",
    Fire_Smoke_Detected:"Fire/Smoke",
  }

  const colorMap = {
    Cyan: process.env.REACT_APP_COLOR1,
    Red: process.env.REACT_APP_COLOR2,
    Blue: process.env.REACT_APP_COLOR3,
    Green: process.env.REACT_APP_COLOR4,
    Purple: process.env.REACT_APP_COLOR5,
    Orange: process.env.REACT_APP_COLOR6,
    Yellow: process.env.REACT_APP_COLOR7,
    Magenta: process.env.REACT_APP_COLOR8,
  };
  
  const genderMap = {
    Male: process.env.REACT_APP_GENDER1,
    Female: process.env.REACT_APP_GENDER2
  };
  
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
    if (newValue === 1) {
      fetchPlaybackVideo();
    }
  };

  const ageArray = ["Over60","18-60","Less18"]
  
  const viewOptions = ["Front", "Side", "Back"];
  const bagOptions = ["HandBag", "ShoulderBag", "Backpack"];
  const sleevesOptions = ["ShortSleeve", "LongSleeve"];
  const upperBodyOptions = ["UpperStride", "UpperLogo", "UpperPlaid", "UpperSplice"];
  const lowerBodyOptions = ["LowerStripe", "LowerPattern", "LongCoat", "Trousers", "Shorts", "Skirt&Dress"];


  const fetchPlaybackVideo = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_PLAYBACK_URL}list?path=secondary${selectedRow.IP}`);
      if (!response.ok) {
        console.error("Network response was not ok");
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        const lastObject = data[data.length - 1];
        setVideoUrl(lastObject);
      } else {
        console.error("No data available in the response.");
      }
    } catch (error) {
      console.error("Error fetching playback video:", error);
    }
  };

  const exportAllGridDataToPDF = async (gridRef) => {
  if (!gridRef.current) return;

  const data = gridRef.current.dataSource || [];
  const doc = new jsPDF();

  const columns = [
      { header: "CamIP", dataKey: "IP" },
      { header: "Name", dataKey: "Name" },
      { header: "Type", dataKey: "type" },
      { header: "Date", dataKey: "formattedDate" },
      { header: "Time", dataKey: "formattedTime" },
      { header: "Image", dataKey: "FrameData" }
  ];

  // Prepare rows
  console.log(data,"dataa")
  const rows = (data || []).map((row, index) => ({
    IP: row?.IP || "N/A",
    Name: row?.Name || "N/A",
    type: row?.type || "N/A",
    formattedDate: row?.formattedDate || "N/A",
    formattedTime: row?.formattedTime || "N/A",
    FrameData: row?.FrameData || ""
}));

  doc.autoTable({
        columns,
        body: rows,
        didDrawCell: (cellData) => {
          // Format Date & Time in a single cell
          /*
          if (cellData.column.dataKey === "formattedDate" && cellData.cell.raw && cellData.cell.section === 'body') {
              const rowIndex = cellData.row.index;
              console.log(rowIndex,"index")
              console.log(rows[rowIndex].formattedDate)
              const date = rows[rowIndex].formattedDate;
              const time = rows[rowIndex].formattedTime;
              const { x, y, width, height } = cellData.cell;

              doc.saveGraphicsState();
              doc.setFontSize(10);
              doc.text(date, x + width / 2, y + height / 4, { align: "center" });
              doc.text(time, x + width / 2, y + height * 3 / 4, { align: "center" });
              doc.restoreGraphicsState();
          }
          */

          // Embed Image
          
            if (cellData.column.dataKey === "FrameData" && cellData.cell.raw && cellData.cell.section === 'body') {
            const rowIndex = cellData.row.index;

            // Ensure row exists before accessing properties
            if (!rows[rowIndex]) {
                console.warn(`Row ${rowIndex} is undefined`);
                return;
            }

            const imgData = rows[rowIndex]?.FrameData || ""; // Ensure imgData is defined

            if (imgData) {
                cellData.cell.text = [];
                cellData.cell.raw = "";
                cellData.cell.styles.fontSize = 0;
                const cellWidth = cellData.cell.width - 4;
                const cellHeight = cellData.cell.height - 2;
                doc.addImage(imgData, "JPEG", cellData.cell.x, cellData.cell.y, cellWidth, cellHeight);
            }
            }
      },
      startY: 10,
      margin: { top: 10 },
      bodyStyles: { fontSize: 9, lineHeight: 12, cellPadding: 5 },
      headStyles: { fontSize: 10, lineHeight: 11, cellPadding: 5 },
      columnStyles: {
            IP: { cellWidth: 20 },
            Name: { cellWidth: 40 },
            type: { cellWidth: 20 },
            formattedDate: { cellWidth: 30 },
            formattedTime: { cellWidth: 30 },
            FrameData: { cellWidth: 25 }
        },
  }); 
  doc.save("VaDetectReportPDF.pdf");
};


  const handleFind = async (page) => {
    if ((fromDate && toDate) || (!fromDate && !toDate)) {
      try {
        setLoading(true);
  
        // Ensure Full ISO Format for Dates
        const formattedFromDate = fromDate ? new Date(fromDate).toISOString() : null;
        const formattedToDate = toDate ? new Date(toDate).toISOString() : null;
  
        // Convert IncludePerson & IncludeVehicle to EntityType Array
        const entityType = [];
        if (includePerson) entityType.push("person");
        if (includeVehicle) entityType.push("vehicle");
  
        // Fetch Data
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getVaDetectFacesReport`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            formattedFromDate,
            formattedToDate,
            page,
            color: selectedColor,
            gender: selectedGender,
            eventType: selectedEvent,  
            age: selectedAge,
            view: selectedView,
            bag: selectedBag,
            sleeves: selectedSleeves,
            upperBody: selectedUpperBody,
            lowerBody: selectedLowerBody,
            entityType 
          }),
          credentials: 'include',
        });
  
        if (response.ok) {
          let result = await response.json();
          console.log(result)
          setTotalCount(result.totalRecords);
          setDetectedData(result.records);
        } else {
          throw new Error('Failed to fetch data. Please try again.');
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false); 
      }
    } else {
      alert('Please Enter Information Correctly');
    }
  };
  
  
  const handlePageChange = (page) => {
    setCurrentPage(page);
    handleFind(page);
  };

  const handleDateChange = (date, isFromDate) => {
  if (isFromDate) {
    setFromDate(date);
  } else {
    setToDate(date);
  }
  setCurrentPage(0);
  };

  return (
    <div>
      <header className="header-menu">
        <div>
          <Menu />
        </div>
      </header>
      <div className="detect-faces-report">
        <h2>VA Report</h2>
        <div className="filters">
          <div className="filter-item">
            <label className="filter-label">From:</label>
            <DatePicker
              selected={fromDate}
              onChange={(date) => handleDateChange(date,true)}
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
              onChange={(date) => handleDateChange(date,false)}
              className="filter-input"
              placeholderText="Select To Date"
              showYearDropdown
              dropdownMode="select" 
            />
          </div>
          <div className="filter-item">
            <input 
              type="checkbox" 
              checked={includePerson} 
              onChange={() => {
      setIncludePerson(!includePerson);
      setCurrentPage(0);
    }} 
            /> Person
          </div>
          <div className="filter-item">
            <input 
              type="checkbox" 
              checked={includeVehicle} 
              onChange={() => {
      setIncludeVehicle(!includeVehicle);
      setCurrentPage(0);
    }} 
            /> Vehicle
          </div>
          <div>
          <button className="filter-button" onClick={() => handleFind(currentPage)}>Find</button>
          </div>
        </div>
        
        <div className="filters">
          <div className="filter-item">
            <label className="filter-label">Color:</label>
            <select 
              value={selectedColor} 
              onChange={(e) => {
        setSelectedColor(e.target.value);
        setCurrentPage(0);
      }} 
              className="filter-input"
            >
              <option value="">All Colors</option>
              {Object.values(colorMap).map((color, index) => (
                <option key={index} value={color}>{color}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-item">
           <label className="filter-label">Age Group:</label>
           <select 
            value={selectedAge} 
            onChange={(e) => {
            setSelectedAge(e.target.value);
            setCurrentPage(0);
           }} 
           className="filter-input"
          >
          <option value="">All Ages</option>
           {ageArray.map((age, index) => (
           <option key={index} value={age}>{age}</option>
          ))}
         </select>
        </div>


          <div className="filter-item">
            <label className="filter-label">Gender:</label>
            <select 
              value={selectedGender} 
              onChange={(e) => {
        setSelectedGender(e.target.value);
        setCurrentPage(0);
      }} 
              className="filter-input"
            >
              <option value="">All Genders</option>
              {Object.values(genderMap).map((gender, index) => (
                <option key={index} value={gender}>{gender}</option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label className="filter-label">Event:</label>
            <select value={selectedEvent} onChange={(e) => {
        setSelectedEvent(e.target.value);
        setCurrentPage(0);
      }} 
       className="filter-input">
              <option value="">All Events</option>
              {Object.entries(eventMap).map(([key, value]) => (
                <option key={key} value={key}>{value}</option>
              ))}
            </select>
          </div>
           </div>
          <div className= "filters">
          
            <div className="filter-item">
  <label className="filter-label">View:</label>
  <select value={selectedView} onChange={(e) => { setSelectedView(e.target.value); setCurrentPage(0); }} className="filter-input">
    <option value="">All</option>
    {viewOptions.map((v, i) => <option key={i} value={v}>{v}</option>)}
  </select>
</div>

<div className="filter-item">
  <label className="filter-label">Bag:</label>
  <select value={selectedBag} onChange={(e) => { setSelectedBag(e.target.value); setCurrentPage(0); }} className="filter-input">
    <option value="">All</option>
    {bagOptions.map((v, i) => <option key={i} value={v}>{v}</option>)}
  </select>
</div>

<div className="filter-item">
  <label className="filter-label">Sleeves:</label>
  <select value={selectedSleeves} onChange={(e) => { setSelectedSleeves(e.target.value); setCurrentPage(0); }} className="filter-input">
    <option value="">All</option>
    {sleevesOptions.map((v, i) => <option key={i} value={v}>{v}</option>)}
  </select>
</div>

<div className="filter-item">
  <label className="filter-label">Upper Body:</label>
  <select value={selectedUpperBody} onChange={(e) => { setSelectedUpperBody(e.target.value); setCurrentPage(0); }} className="filter-input">
    <option value="">All</option>
    {upperBodyOptions.map((v, i) => <option key={i} value={v}>{v}</option>)}
  </select>
</div>

<div className="filter-item">
  <label className="filter-label">Lower Body:</label>
  <select value={selectedLowerBody} onChange={(e) => { setSelectedLowerBody(e.target.value); setCurrentPage(0); }} className="filter-input">
    <option value="">All</option>
    {lowerBodyOptions.map((v, i) => <option key={i} value={v}>{v}</option>)}
  </select>
</div>

          
         
        </div>
  
        <div className='grid-container'>
        {loading ? ( 
          <p className="loading-text">Loading...</p> 
        ) : (
          <div>
        <GridComponent
          ref={gridRef}
          dataSource={detectedData.map((item, index) => ({
            ...item,
            serialNo: index + 1, // Adding Serial Number
            formattedEvent: eventMap[item.Event.toLowerCase()] || item.Event, // Mapping event name
            formattedDate: new Date(item.Timestamp).toLocaleDateString(), // Extract Date
            formattedTime: new Date(item.Timestamp).toLocaleTimeString()  // Extract Time
          }))}
          allowSorting={true}
          pageSettings={{ pageSize: itemsPerPage, currentPage }}
        >
          <ColumnsDirective>

            {/* Camera IP Column */}
            <ColumnDirective field='IP' headerText='Camera IP' width='120' textAlign="Center" />

            {/* Mapped Event Name Column */}
            <ColumnDirective field='Name' headerText='Name' width='150' textAlign="Center" />

            {/* Description Column */}
            <ColumnDirective 
              field='Description' 
              headerText='Description' 
              width='200' 
              textAlign="Center" 
              template={(rowData) => rowData.Description || 'N/A'} 
            />

            {/* Type Column */}
            <ColumnDirective 
              field='Type' 
              headerText='Type' 
              width='120' 
              textAlign="Center" 
              template={(rowData) => rowData.Parameters[0]?.type ? rowData.Parameters[0]?.type : 'N/A'} 
            />

            {/* Remark Column */}
            <ColumnDirective 
              field='Remark' 
              headerText='Remark' 
              width='120' 
              textAlign="Center" 
              template={(rowData) => rowData.Remark || 'N/A'} 
            />

            <ColumnDirective field='formattedDate' headerText='Date' width='120' textAlign="Center" />
            <ColumnDirective field='formattedTime' headerText='Time' width='120' textAlign="Center" />

            {/* Image Column */}
            <ColumnDirective
              headerText='Image'
              width='150'
              textAlign="Center"
              template={(rowData) => (
                <img 
                  src={rowData.FrameData ? `${rowData.FrameData}` : defaultImage} 
                  alt="Face" 
                  style={{ width: 70, height: 70 }} 
                />
              )}
            />
            <ColumnDirective
              headerText="Details"
              width="100"
              textAlign="Center"
              template={(rowData) => (
                <button onClick={() => handleOpenModal(rowData)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                  <Visibility style={{ color: "#007bff", fontSize: "22px" }} />
                </button>
              )}
            />
          </ColumnsDirective>
          <Inject services={[Sort]} />
        </GridComponent>
        <Dialog open={openModal} onClose={handleCloseModal} maxWidth="sm" fullWidth>
      <div style={{ padding: "20px" }}>
        <h2 style={{ textAlign: "center" }}>Detailed Information</h2>

        {/* Tabs for Switching between Details and Playback */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={handleTabChange} aria-label="camera modal tabs">
            <Tab label="Details Info" sx={{
    color: 'blue',
    '&:hover': {
      backgroundColor: 'transparent',
    },
  }}
  />
            <Tab label="Playback" sx={{
                color: 'blue',
                '&:hover': {
                backgroundColor: 'transparent',
                },
            }}
            />
          </Tabs>
        </Box>

        {/* Content based on active tab */}
        {activeTab === 0 && (
          <div>
            {selectedRow && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td><strong>Camera IP:</strong></td>
                    <td>{selectedRow.IP || "N/A"}</td>
                  </tr>
                  <tr>
                    <td><strong>Name:</strong></td>
                    <td>{selectedRow.formattedEvent || "N/A"}</td>
                  </tr>
                  <tr>
                    <td><strong>Description:</strong></td>
                    <td>{selectedRow.Description || "N/A"}</td>
                  </tr>
                  <tr>
                    <td><strong>Type:</strong></td>
                    <td>{selectedRow.Type || "N/A"}</td>
                  </tr>
                  <tr>
                    <td><strong>Remark:</strong></td>
                    <td>{selectedRow.Remark || "N/A"}</td>
                  </tr>
                  <tr>
                    <td><strong>Date:</strong></td>
                    <td>{selectedRow.formattedDate}</td>
                  </tr>
                  <tr>
                    <td><strong>Time:</strong></td>
                    <td>{selectedRow.formattedTime}</td>
                  </tr>

                  {/* Additional Parameters */}
                  {selectedRow.Parameters && (
                    <>
                      <tr>
                        <td><strong>Age:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.Age || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Color:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.color || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Gender:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.Gender || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Count:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.count || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>View:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.View || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Bag:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.Bag || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Sleeves:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.Sleeves || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>UpperBody:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.UpperBody || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>LowerBody:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.attributes?.LowerBody || "N/A").join(", ")}</td>
                      </tr>
                      <tr>
                        <td><strong>Type:</strong></td>
                        <td>{selectedRow.Parameters.map(param => param.type || "N/A").join(", ")}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td colSpan="2" style={{ textAlign: "center", paddingTop: "10px" }}>
                      {selectedRow.FrameData ? (
                        <img src={selectedRow.FrameData} alt="Captured" style={{ width: "150px", height: "150px" }} />
                      ) : (
                        <p>No Image Available</p>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 1 && (
  <div style={{ textAlign: "center", marginTop: "20px" }}>
    <video
      controls
      autoPlay
      muted
      style={{ width: "100%", maxWidth: "640px", margin: "0 auto", backgroundColor: "black" }}
    >
      {videoUrl && <source src={videoUrl.url} type="video/mp4" />}
      Your browser does not support the video tag.
    </video>
  </div>
)}

        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <button
            onClick={handleCloseModal}
            style={{
              padding: "10px 20px",
              background: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>

      </div>
        )}
          {detectedData.length ? 
            (
              <Pagination
                itemsPerPage={itemsPerPage}
                totalItems={totalCount}
                paginate={handlePageChange}
                currentPage={currentPage}
              />
            )
            :
            (<></>)
          }
        </div>
        {detectedData.length ? 
          (<button type='button' className='exportPdfButton' onClick={() => exportAllGridDataToPDF(gridRef)}>Export to PDF</button>)
          :
          (<></>) 
        }
      </div>
    </div>
    );
};

export default DetectFacesReport;
