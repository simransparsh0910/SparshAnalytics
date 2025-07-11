import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Modal,
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  FormControl,
  InputLabel,
  OutlinedInput,
  RadioGroup,
  FormControlLabel,
  Radio
} from "@mui/material";
import { Stage, Layer, Circle, Line, Image } from "react-konva";
import { useImage } from 'react-konva';
import { WHEPClient } from "./webrtcClient";

const DrawROIPopup = ({ open, onClose, cameraData }) => {
  const [polygons, setPolygons] = useState([]);
  const [lines, setLines] = useState([]);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [frameCaptured, setFrameCaptured] = useState(false);
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawingMode, setDrawingMode] = useState("polygon");
  const [selectedAnalytics, setSelectedAnalytics] = useState(cameraData.analytictype ? cameraData.analytictype : []);
  const [loiteringTime, setLoiteringTime] = useState("");
  const [dots, setDots] = useState([]);
  const [shapeDrawn, setShapeDrawn] = useState(false);
  const [scaledDims, setScaledDims] = useState({ width: 640, height: 640 });
  const clientRef = useRef(null);
  const videoRef = useRef(null);
  const [analytics, setAnalytics] = useState([]);
  const[crowdFormation, setCrowdFormation] = useState("");
const[crowdFormationDuration, setCrowdFormationDuration] = useState("");
const[crowdEstimation, setCrowdEstimation] = useState("");
const[crowdEstimationDuration, setCrowdEstimationDuration] = useState("");
const[crowdDispersion, setCrowdDispersion] = useState("");
const[crowdDispersionDuration, setCrowdDispersionDuration] = useState("");

  const [fetchedLine, setFetchedLine] = useState(cameraData.lines ? cameraData.lines : []);
  const [polygon, setPolygon] = useState(cameraData.polygon ? cameraData.polygon : [])
  const [entryType, setEntryType] = useState(cameraData.entry_line_type ? cameraData.entry_line_type : "")
  const [exitType, setExitType] = useState(cameraData.exit_line_type ? cameraData.exit_line_type : "")
  const [isUpdate, setIsUpdate] = useState(cameraData.isUpdated ? true:false);
  const [direction, setDirection] = useState("Left to Right");

  useEffect(() => {
  if (open && cameraData?.streamid && videoRef.current) {
    clientRef.current = new WHEPClient(
      cameraData.secondarystream, `video-${cameraData.streamid}`, setLoading);
  }
  return () => {
    if (clientRef.current) {
      clientRef.current.destroy();
    }
  };
}, [open, cameraData, videoRef.current]);


  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getAnalytics`);
      const data = await response.json();
      setAnalytics(data.analytics || []);
    } catch (error) {
      console.error("Error fetching analytics:", error);
    }
  };

  const captureFrame = () => {
    const video = document.getElementById(`video-${cameraData.streamid}`);
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const capturedImage = new window.Image();
    capturedImage.src = canvas.toDataURL();
    capturedImage.onload = () => {
      setImage(capturedImage);
      setFrameCaptured(true);
      setScaledDims({ width: 640, height: 640 }); // Force-fit
      clientRef.current.destroy();
    }
  };

  const handleClick = (e) => {
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const x = Math.trunc(pointer.x);
    const y = Math.trunc(pointer.y);

    if (drawingMode === "line") {
      const updatedDots = [...dots, { x, y }];
      setDots(updatedDots);
      if (updatedDots.length === 4) {
        setLines([...lines, updatedDots]);
        setShapeDrawn(true);
      }
    } else {
      const updatedDots = [...dots, { x, y }];
      setDots(updatedDots);
    }
  };

  const finalizePolygon = () => {
    if (dots.length >= 4) {
      setPolygons([...polygons, [...dots]]);
      setShapeDrawn(true);
    }
  };

  const handleAnalyticsChange = (e) => {
    setSelectedAnalytics(e.target.value);
  };

 const handleSubmit = async (e) => {
  e.preventDefault();

  /*
  if (dots.length !== 4 || lines.length === 0) {
    alert("Please draw exactly two lines (4 points).");
    return;
  }
  */

  const lineDots = lines.length > 0 ? lines[lines.length - 1].map(({ x, y }) => [x, y]) : [];
  const polygonDots = polygons.length > 0 ? polygons[polygons.length - 1].map(({ x, y }) => [x, y]) : [];

  // Initialize line types
  let entry_line_type = "horizontal";
  let exit_line_type = "horizontal";

  if (lineDots.length >= 4) {
    const [ex1, ey1] = lineDots[0];
    const [ex2, ey2] = lineDots[1];
    const dx_entry = Math.abs(ex2 - ex1);
    const dy_entry = Math.abs(ey2 - ey1);
    entry_line_type = dy_entry > dx_entry ? "vertical" : "horizontal";

    const [ex3, ey3] = lineDots[2];
    const [ex4, ey4] = lineDots[3];
    const dx_exit = Math.abs(ex4 - ex3);
    const dy_exit = Math.abs(ey4 - ey3);
    exit_line_type = dy_exit > dx_exit ? "vertical" : "horizontal";
  }

  const payload = {
    dots: polygonDots.length ? polygonDots:polygon,
    lineDots: lineDots.length ? lineDots:fetchedLine,
    entry_line_type: lineDots.length ? entry_line_type:entryType,
    exit_line_type: lineDots.length ? exit_line_type:exitType,
    cameraData: { ...cameraData, analytictype: selectedAnalytics },
    direction:direction,
    crowd_formation_threshold: selectedAnalytics.includes("crowd_formation") ? crowdFormation : "0",
    crowd_formation_duration: selectedAnalytics.includes("crowd_formation") ? crowdFormationDuration : "0",
    crowd_estimation_threshold: selectedAnalytics.includes("crowd_estimation") ? crowdEstimation : "0",
    crowd_estimation_duration: selectedAnalytics.includes("crowd_estimation") ? crowdEstimationDuration : "0",
    crowd_dispersion_threshold: selectedAnalytics.includes("crowd_dispersion") ? crowdDispersion : "0",
    crowd_dispersion_duration: selectedAnalytics.includes("crowd_dispersion") ? crowdDispersionDuration : "0",
    loitering_threshold: selectedAnalytics.includes("loitering") ? loiteringTime : "0",
  };

  try {
    const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/addRoi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });

    if (response.ok) handleReset();
    else{
      let error = await response.json()
      window.alert(error.message || "Failed to add Analytics")
      handleReset();
    } 
  } catch (error) {
    console.error("Error:", error);
  }
};


  const handleReset = () => {
    setPolygons([]);
    setLines([]);
    setCurrentPoints([]);
    setDots([]);
    setFrameCaptured(false);
    setImage(null);
    setLoading(true);
    setLoiteringTime("");
    setCrowdFormation("")
    setCrowdFormationDuration("")
    setCrowdEstimation("")
    setCrowdEstimationDuration("")
    setCrowdDispersion("")
    setCrowdDispersionDuration("")
    setSelectedAnalytics([]);
    setShapeDrawn(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{ p: 4, backgroundColor: 'white', width: '641px',height: "650px", margin: '100px auto', borderRadius: 2 }}>
        <Typography variant="h6">Draw ROI</Typography>
        <div style={{ margin: '10px 0' }}>
          <FormControl component="fieldset">
            <RadioGroup row value={drawingMode} onChange={(e) => {
              const mode = e.target.value;
              setDrawingMode(mode);
              setDots([]);
              setShapeDrawn(false);
              // setSelectedAnalytics([]);
              // setLoiteringTime("");
              // setCrowdThreshold("");
            }}>
              <FormControlLabel value="polygon" control={<Radio />} label="Polygon" />
              <FormControlLabel value="line" control={<Radio />} label="Line" />
            </RadioGroup>
          </FormControl>
        </div>

        <FormControl fullWidth>
          <Select multiple value={selectedAnalytics} onChange={handleAnalyticsChange} renderValue={(selected) => selected.join(", ")}>
            {analytics
              .filter((analytic) =>
                drawingMode === "polygon" ? analytic !== "person_in_out_count" : analytic === "person_in_out_count"
              )
              .map((analytic) => (
                <MenuItem key={analytic} value={analytic}>
                  <Checkbox checked={selectedAnalytics.includes(analytic)} />
                  <ListItemText primary={analytic} />
                </MenuItem>
              ))}
          </Select>
        </FormControl>
<div>
        {selectedAnalytics.includes("loitering") && (
          <TextField label="Loitering Time (seconds)" type="number" fullWidth value={loiteringTime} onChange={(e) => setLoiteringTime(e.target.value)} />
        )}

        {selectedAnalytics.includes("crowd_formation") && (
        <>
          <TextField label="Crowd Formation Threshold" type="number" fullWidth value={crowdFormation} onChange={(e) => setCrowdFormation(e.target.value)} />
           <TextField label="Crowd Formation Duration" type="number" fullWidth value={crowdFormationDuration} onChange={(e) => setCrowdFormationDuration(e.target.value)} />
           </>
        )}
        
        
        {selectedAnalytics.includes("crowd_estimation") && (
        <>
          <TextField label="Crowd Estimation Threshold" type="number" fullWidth value={crowdEstimation} onChange={(e) => setCrowdEstimation(e.target.value)} />
           <TextField label="Crowd Estimation Duration" type="number" fullWidth value={crowdEstimationDuration} onChange={(e) => setCrowdEstimationDuration(e.target.value)} />
           </>
        )}
        
        
        {selectedAnalytics.includes("crowd_dispersion") && (
        <>
          <TextField label="Crowd Dispersion Threshold" type="number" fullWidth value={crowdDispersion} onChange={(e) => setCrowdDispersion(e.target.value)} />
           <TextField label="Crowd Dispersion Duration" type="number" fullWidth value={crowdDispersionDuration} onChange={(e) => setCrowdDispersionDuration(e.target.value)} />
           </>
        )}
        </div>
        {selectedAnalytics.includes("wrong_direction") && (
        <RadioGroup row value={direction} onChange={(e) => {
          const value = e.target.value;
          setDirection(value)
        }}>
          <FormControlLabel value="Left to Right" control={<Radio />} label="Left to Right" />
          <FormControlLabel value="Right to Left" control={<Radio />} label="Right to Left" />
        </RadioGroup>
        )}
        {!frameCaptured ? (
          <video ref={videoRef} id={`video-${cameraData.streamid}`} style={{ height: "364px" }} autoPlay muted playsInline ></video>
        ) : (
          <Stage width={640} height={640} onClick={handleClick} style={{ marginTop: "10px" }}>
            <Layer>
              {image && <Image image={image} x={0} y={0} width={640} height={640} />}
              {dots.map((dot, index) => (
                <Circle key={index} x={dot.x} y={dot.y} radius={4} fill="red" />
              ))}
              {drawingMode === "polygon" && shapeDrawn && (
                <Line points={dots.flatMap(({ x, y }) => [x, y])} closed stroke="blue" strokeWidth={2} />
              )}
              {drawingMode === "line" && dots.length === 4 && (
                <>
                  <Line points={[dots[0].x, dots[0].y, dots[1].x, dots[1].y]} stroke="green" strokeWidth={2} />
                  <Line points={[dots[2].x, dots[2].y, dots[3].x, dots[3].y]} stroke="green" strokeWidth={2} />
                </>
              )}
            </Layer>
          </Stage>
        )}

        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
          {!frameCaptured && <Button variant="contained" onClick={captureFrame}>Capture Frame</Button>}
          {drawingMode === "polygon" && frameCaptured && dots.length >= 4 && (
            <Button variant="contained" onClick={finalizePolygon}>Finalize Polygon</Button>
          )}
         <Button variant="contained" onClick={handleSubmit}>{isUpdate?"Update":"Submit"}</Button>
          <Button variant="outlined" onClick={handleReset}>Reset</Button>
        </Box>
      </Box>
    </Modal>
  );
};

export default DrawROIPopup;
