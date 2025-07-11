import React, { useState, useEffect, useRef } from 'react';
import { GridComponent, ColumnsDirective, ColumnDirective, Sort, Inject} from '@syncfusion/ej2-react-grids';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import "./DetectFacesReport.css";
import jsPDF from "jspdf";
import "jspdf-autotable";
import Pagination from './Pagination';

const InOutReport = () => {
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
   
  const exportAllGridDataToPDF = async (gridRef) => {
    if (!gridRef.current) return;

    const data = gridRef.current.dataSource || [];
    const doc = new jsPDF();

    const columns = [
        { header: "Person Id", dataKey: "rtsp_id" },
        { header: "Person Name", dataKey: "name" },
        { header: "Type", dataKey: "score" },
        { header: "Remark", dataKey: "timestamp" },
        { header: "Group", dataKey: "group_name" },
        // { header: "Image", dataKey: "image" }
    ];

    // Prepare rows with resized images
    
    // const rows = await Promise.all(data.map(async row => {
    //     // const imageDataUrl = row.image ? await convertBase64ToImageDataUrl(row.image) : null;
    //     // console.log(imageDataUrl,"imageDataURL")
    //   return {
    //       id: row.id,
    //       name: row.name,
    //       type: row.type,
    //       remark: row.remark,
    //       date: row.date,
    //       group_name: row.group_name || 'N/A',
    //       image: row.image ? `data:image/jpeg;base64,${row.image}` : defaultImage
    //   };
    // }));

    const rows = data.map(row => ({
      id: row.rtsp_id,
      name: row.name,
      type: row.score,
      remark: row.timestamp,
      group_name: row.group_name || 'N/A',
      // image: row.image ? `data:image/jpeg;base64,${row.image}` : "Hello" // Set full base64 string
    }));
    console.log(rows);
    doc.autoTable({
        columns,
        body: rows,
        // didDrawCell: (data) => {
        //   // console.log(doc.validateStringAsBase64(data.cell.raw))
        //     if (data.column.dataKey === "image" && data.cell.raw) {
        //       const imgData = data.cell.raw;
        //         console.log(imgData,"imageData")
        //         if (imgData) {
        //           // data.cell.text = [];
        //           // data.cell.raw = "";
        //           console.log(data,"after");
        //           // doc.addImage(imgData, "JPEG", data.cell.x + 2, data.cell.y + 2, 20, 20);
        //       }
        //     }
        // },
        startY: 10,
    });

    doc.save("DetectedDataPDF.pdf");
};

  const handleFind = async (page) => {
    if ((fromDate && toDate) || (!fromDate && !toDate && personName)) {
      try {
        const response = await fetch('http://localhost:8080/getDetectFacesReport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromDate, toDate, personName, page }),
        });

        if (response.ok) {
          const result = await response.json();
          // setDetectedData(result.records);
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

  const handlePageChange = (page) => {
    console.log("page", page)
    setCurrentPage(page);
    handleFind(page);
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:4000');
    ws.onmessage = (event) => {
      const receivedData = JSON.parse(event.data);
      if (receivedData.type === 'detectedData') {
        setDirr(`${receivedData.dirName}\\FaceRecognition\\`)
        const parsedData = JSON.parse(receivedData.data);
        setTotalCount(parsedData.total_records);
        setDetectedData(parsedData.records);
      }
    };

    ws.onclose = () => console.log('WebSocket connection closed');
    return () => ws.close();
  }, []);

  return (
    <div className="detect-faces-report">
      <h2>Detect Faces Report</h2>
      <div className="filters">
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
            value={personName} 
            onChange={(e) => setPersonName(e.target.value)} 
            placeholder="Enter Name"
            className="filter-input"
          />
        </div>

        <button className="filter-button" onClick={() => handleFind(currentPage)}>Find</button>
      </div>

      <div className='grid-container'>
        <GridComponent
          ref={gridRef}
          dataSource={detectedData}
          allowSorting={true}
          // allowPdfExport={true}
          pageSettings={{ pageSize: itemsPerPage, currentPage }}
        >
          <ColumnsDirective>
            <ColumnDirective field='rtsp_id' headerText='Camera ID' width='120' textAlign="Center" />
            <ColumnDirective field='name' headerText='Name' width='150' textAlign="Center" />
            <ColumnDirective 
              field='score' 
              headerText='Percentage' 
              width='150' 
              textAlign="Center" 
              valueAccessor={(field, rowData) => parseFloat(rowData[field]) ? parseFloat(rowData[field]).toFixed(3) : "N/A"}
            />
            <ColumnDirective 
              field='timestamp' 
              headerText='Date' 
              width='150' 
              textAlign="Center" 
              valueAccessor={(field, rowData) => {
                const [date, time] = rowData[field].split(" ");
                return `${date}\n${time}`;
              }}
            />
            <ColumnDirective
              headerText='Group'
              width='150'
              textAlign="Center"
              template={(rowData) => rowData.group_name ? rowData.group_name : 'N/A'}
            />
            <ColumnDirective
              headerText='Image'
              width='150'
              textAlign="Center"
              template={(rowData) => (
                // <img src={rowData.image_path? `http://localhost:8080/images/${dirr}${rowData.image_path}` : defaultImage} alt="Face" style={{ width: 50 }} />
                <img src={defaultImage} alt="Face" style={{ width: 50 }} />
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
        (<button type='button' className='exportPdfButton' onClick={exportAllGridDataToPDF}>Export to PDF</button>)
        :
        (<></>) 
      }
    </div>
  );
}

export default InOutReport