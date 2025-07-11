import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GridComponent, ColumnsDirective, ColumnDirective, Sort, Inject} from '@syncfusion/ej2-react-grids';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import "./DetectFacesReport.css";
import jsPDF from "jspdf";
import "jspdf-autotable";
import Pagination from './Pagination';
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';
//import Footer from './Footer';
import Layout from './Layout';


const DetectFacesReport = () => {
  const [fromDate, setFromDate] = useState();
  const [toDate, setToDate] = useState();
  const [detectedData, setDetectedData] = useState([]);
  const [itemsPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [personName, setPersonName] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [dirr, setDirr] = useState('');
  const gridRef = useRef(null);
  const defaultImage = "/assets/defaultImage.png";
  const [gender, setGender] = useState('');
const [glasses, setGlasses] = useState('');
const [beard, setBeard] = useState('');
const [ageFrom, setAgeFrom] = useState('');
const [ageTo, setAgeTo] = useState('');
  
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
  
  const exportAllGridDataToPDF = async (gridRef) => {
    if (!gridRef.current) return;

    const data = gridRef.current.dataSource || [];
    console.log(data,"tableData")
    
    const doc = new jsPDF();
//console.log(data,"data")
    const columns = [
        { header: "CamId", dataKey: "IP" },
        { header: "Name", dataKey: "Name" },
       // { header: "Percentage", dataKey: "score" },
        { header: "Date", dataKey: "formattedDate" },
        { header: "Time", dataKey: "formattedTime" },
         { header: "Gender", dataKey: "Gender" },
         { header: "Age", dataKey: "Age" },
       // { header: "Group", dataKey: "group_name" },
        { header: "Image", dataKey: "FrameData" }
    ];

    // Prepare rows
    const rows = data.map(row => ({
        IP: row.IP,
        Name: row.Name,
      //  score: parseFloat(row.score) ? parseFloat(row.score).toFixed(4) : "N/A",
        formattedDate: row.formattedDate,
        formattedTime: row.formattedTime,
        Gender: row.Parameters[0].attributes.Gender,
        Age: row.Parameters[0].attributes.Age,
       // group_name: row.group_name || 'N/A',
        FrameData: " "
    }));
    doc.autoTable({
        columns,
        body: rows,
        didDrawCell: (cellData) => {
          /*
          if (cellData.column.dataKey === "timestamp" && cellData.cell.raw && cellData.cell.section === 'body') {
                const rowIndex = cellData.row.index;
                const [dateData, timeData] = data[rowIndex].timestamp.split(" ");
                
                const { x, y, width, height } = cellData.cell;

                // Get the date and time from the row data
                const date = dateData
                const time = timeData

                // Save the graphics state to ensure no other transformations affect it
                doc.saveGraphicsState();

                // Set font size for the text
                doc.setFontSize(10);

                // Draw the date and time vertically in the same cell
                doc.text(date, x + width / 2, y + height / 4, { align: "center" });
                doc.text(time, x + width / 2, y + height * 3 / 4, { align: "center" });

                // Restore the graphics state
                doc.restoreGraphicsState();
            }
        */
        
          if (cellData.column.dataKey === "FrameData" && cellData.cell.raw && cellData.cell.section === 'body') {
                const rowIndex = cellData.row.index;
                const imgData = data[rowIndex].FrameData;
                console.log(imgData,"image data")

                if (imgData) {
                  cellData.cell.text = [];
                  cellData.cell.raw = "";
                  cellData.cell.styles.fontSize = 0;

                    // Calculate dimensions for the image to fit within the cell
                    const cellWidth = cellData.cell.width - 2;
                    const cellHeight = cellData.cell.height - 1;

                    doc.addImage(imgData, "JPEG", cellData.cell.x, cellData.cell.y, cellWidth, cellHeight);
                }
            }
        },
        startY: 10,
        margin: { top: 10 },
        bodyStyles: {
            fontSize: 9, 
            lineHeight: 12, 
            cellPadding: 5,
        },
        headStyles: {
            fontSize: 10, 
            lineHeight: 11, 
            cellPadding: 5,
        },
        columnStyles: {
            IP: { cellWidth: 21 }, 
            Name: { cellWidth: 27 }, 
            formattedDate: { cellWidth: 30 }, 
            formattedTime: { cellWidth: 30 }, 
            Gender: {cellWidth: 30},
            Age: {cellWidth: 20},
            FrameData: { cellWidth: 25 },
        },
    });
    
    doc.save("DetectFacesReportPDF.pdf");
  };

  const handleFind = async (page) => {
  // Check if at least one filter is filled
  const isFilterApplied = fromDate || toDate || personName || gender || glasses || beard || ageFrom || ageTo;

  if (!isFilterApplied) {
    alert('Please enter at least one filter value.');
    return;
  }

  const payload = {
    fromDate,
    toDate,
    personName,
    gender,
    glasses,
    beard,
    ageFrom: ageFrom ? parseInt(ageFrom) : undefined,
    ageTo: ageTo ? parseInt(ageTo) : undefined,
    page
  };

  try {
    const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getDetectFacesReport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("📦 Report Data:", data);
      const newData = data.records
      console.log(newData,"newData")
      const formattedData = newData.map(item => {
    const dateObj = new Date(item.Timestamp);
    return {
        ...item,
        formattedDate: dateObj.toLocaleDateString('en-GB'), // "27/05/2025"
        formattedTime: dateObj.toLocaleTimeString('en-GB', { hour12: false }) // "09:11:05"
    };
});
console.log(formattedData,"format")
      setTotalCount(data.totalRecords);
        setDetectedData(formattedData);
        
      // Do something with the data here, e.g. setReport(data);
    } else {
      throw new Error('Failed to fetch data. Please try again.');
    }
  } catch (error) {
    console.error('Error fetching data:', error);
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
  setCurrentPage(0); // Reset the page to 0
  };

  useEffect(() => {
    const ws = new WebSocket(`${process.env.REACT_APP_WEBSOCKET_URL}`);
    ws.onmessage = (event) => {
      const receivedData = JSON.parse(event.data);
      if (receivedData.type === 'detectedData') {
        setDirr(`${receivedData.dirName}/FaceRecognition/`)
        const parsedData = JSON.parse(receivedData.data);
        setTotalCount(parsedData.total_records);
        setDetectedData(parsedData.records);
      }
    };

    ws.onclose = () => console.log('WebSocket connection closed');
    return () => ws.close();
  }, []);
  
  const handleRowDataBound = (args) => {
  if (args.data.type === 'blacklist') {
    args.row.style.backgroundColor = '#ffe5e5'; 
    args.row.style.color = 'white';
  }
};

  return (
  <Layout>
    <div>
      <header className="header-menu">
        <div>
          <Menu />
        </div>
      </header>
      <div className="detect-faces-report">
        <h2>FRS Report</h2>
        <div className="filters">

  {/* Row 1: Date + Name */}
  <div className="filter-row">
    <div className="filter-item">
      <label className="filter-label">From:</label>
      <DatePicker
        selected={fromDate}
        onChange={(date) => handleDateChange(date, true)}
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
        onChange={(date) => handleDateChange(date, false)}
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
        value={personName}
        onChange={(e) => setPersonName(e.target.value)}
        placeholder="Enter Name"
        className="filter-input"
      />
    </div>
  </div>

  {/* Row 2: Advanced Filters */}
  <div className="filter-row">
    <div className="filter-item">
      <label className="filter-label">Gender:</label>
      <select
        className="filter-input"
        value={gender}
        onChange={(e) => setGender(e.target.value)}
      >
        <option value="">Select Gender</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
      </select>
    </div>

    <div className="filter-item">
      <label className="filter-label">Glasses:</label>
      <select
        className="filter-input"
        value={glasses}
        onChange={(e) => setGlasses(e.target.value)}
      >
        <option value="">Select Glasses</option>
        <option value="With Glasses">With Glasses</option>
        <option value="Without Glasses">Without Glasses</option>
      </select>
    </div>

    <div className="filter-item">
      <label className="filter-label">Beard:</label>
      <select
        className="filter-input"
        value={beard}
        onChange={(e) => setBeard(e.target.value)}
      >
        <option value="">Select Beard</option>
        <option value="Beard">Beard</option>
        <option value="No Beard">No Beard</option>
      </select>
    </div>

    <div className="filter-item">
      <label className="filter-label">Age:</label>
      <div className="age-range">
        <input
          type="number"
          placeholder="From"
          value={ageFrom}
          onChange={(e) => setAgeFrom(e.target.value)}
          className="filter-input small"
          min="0"
        />
        <span>to</span>
        <input
          type="number"
          placeholder="To"
          value={ageTo}
          onChange={(e) => setAgeTo(e.target.value)}
          className="filter-input small"
          min="0"
        />
      </div>
    </div>

    <div className="filter-item align-end">
      <button className="filter-button" onClick={() => handleFind(currentPage)}>Find</button>
    </div>
  </div>

</div>

  
        <div className='grid-container'>
          <GridComponent
            ref={gridRef}
            dataSource={detectedData.map((item, index) => ({
            ...item,
            serialNo: index + 1, 
            
          }))}
            allowSorting={true}
            // allowPdfExport={true}
            pageSettings={{ pageSize: itemsPerPage, currentPage }}
            rowDataBound={handleRowDataBound}
          >
            <ColumnsDirective>
  {/* Serial Number Column */}

  {/* Camera IP Column */}
  <ColumnDirective field='IP' headerText='Camera Id' width='100' textAlign="Center" />

  {/* Mapped Event Name Column */}
  <ColumnDirective field='Name' headerText='Name' width='120' textAlign="Center" />

  {/* Description Column */}
 

  {/* Type Column */}
  <ColumnDirective 
    field='Type' 
    headerText='Type' 
    width='100' 
    textAlign="Center" 
    template={(rowData) => rowData.Type || 'N/A'} 
  />

<ColumnDirective 
  field='score' 
  headerText='Score' 
  width='120' 
  textAlign="Center" 
  template={(rowData) => 
    rowData.score != null ? parseFloat(rowData.score).toFixed(3) : 'N/A'
  }
/>

  {/* Gender Column */}
  <ColumnDirective 
    headerText='Gender' 
    width='100' 
    textAlign="Center" 
    template={(rowData) => rowData.Parameters[0].attributes.Gender || 'N/A'} 
  />

<ColumnDirective 
    headerText='Beard' 
    width='100' 
    textAlign="Center" 
    template={(rowData) => rowData.Parameters[0].attributes.Beard || 'N/A'} 
  />
  
  <ColumnDirective 
    headerText='Glasses' 
    width='100' 
    textAlign="Center" 
    template={(rowData) => rowData.Parameters[0].attributes.Glasses || 'N/A'} 
  />


  {/* Age Column */}
  <ColumnDirective 
    field='age' 
    headerText='Age' 
    width='80' 
    textAlign="Center" 
    template={(rowData) => rowData.Parameters[0].attributes.Age || 'N/A'} 
  />

  {/* Date & Time */}
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
</ColumnsDirective>


            <Inject services={[Sort]} />
          </GridComponent>
  
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
      </Layout>
    );
};

export default DetectFacesReport;
