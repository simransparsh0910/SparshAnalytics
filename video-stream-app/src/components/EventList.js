import React, { useState, useEffect,useRef } from 'react';
import './EventList.css';
import VideoCapture from './VideoCapture';

const EventList = ({ onDeviceSelected, eventShow }) => {
  const [activeTab, setActiveTab] = useState(eventShow?"events":"devices");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const ws = new WebSocket(`${process.env.REACT_APP_WEBSOCKET_URL}`);
  
    ws.onmessage = async (event) => {
      try {
        const parsed = JSON.parse(event.data);
  console.log(parsed, "🔁 Raw incoming WebSocket data");

  // Double-check structure here
  const eventData = JSON.parse(parsed.type === 'generalData' && parsed.data ? parsed.data : parsed);
  console.log(eventData,"eventData")
  
        const {
          DeviceId,
          DetectedImage,
          OriginalImage,
          FullframeImage,
          PersonName,
          Timestamp,
          Event,
          Type,
          Remark,
          Parameters,
          angles
        } = eventData;
  
        const newEvent = {
          eventId: DeviceId,
          eventImage: DetectedImage,
          eventOrgImage: OriginalImage || null,
          eventFullFrame: FullframeImage,
          eventName: PersonName,
          eventTime: Timestamp,
          eventType: Type,
          eventRemark: Remark,
          eventParameters: Parameters || {},
          eventAngles: angles || []
        };
  
        console.log("✅ Adding newEvent to state:", newEvent);
  
        setEvents((prevEvents) => {
          if (prevEvents.length >= 20) {
            return [newEvent, ...prevEvents.slice(0, 19)];
          }
          return [newEvent, ...prevEvents];
        });
  
      } catch (err) {
        // Safe catch — don’t break UI
        console.warn("⚠️ WebSocket message handling failed:", err.message);
      }
    };
  
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  
    ws.onclose = () => {
      console.log("WebSocket closed");
    };
  
    return () => ws.close();
  }, []);
  

  useEffect(() => {
  
    const fetchDevices = async () => {
      try {
        const response = await fetch('/streams.json');
        const data = await response.json();
        console.log(data,"stream file data");
        setDevices(data.streams);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching devices:', error);
        setLoading(false);
      }
    };

    fetchDevices();
  }, []);

  const fetchDeviceData = async (targetElement, streamid, index) => {
    const existingDropdown = targetElement.querySelector('.dropdown-container');

    if (existingDropdown) {
      const isCurrentlyOpen = !existingDropdown.classList.contains('hidden');
      if (isCurrentlyOpen) {
        existingDropdown.classList.add('hidden');
        return;
      } else {
        existingDropdown.classList.remove('hidden');
        return;
      }
    }

  // If a new dropdown is being opened, clear the previously active dropdown
    document.querySelectorAll('.dropdown-container').forEach((el) => el.remove());
    try {
      const response = await fetch(`${process.env.REACT_APP_PLAYBACK_URL}list?path=${streamid}`);
      const data = await response.json();
      targetElement.querySelector('.dropdown-container')?.remove();

      const dateMap = {};
      data.forEach((item) => {
        const date = item.start.split('T')[0];
        if (!dateMap[date]) {
          dateMap[date] = [];
        }
        dateMap[date].push(item);
      });

      const dropdownContainer = document.createElement('div');
      dropdownContainer.className = 'dropdown-container';

      Object.keys(dateMap).forEach((date) => {
        const dateDropdown = document.createElement('div');
        dateDropdown.className = 'date-dropdown';

        const dateLabel = document.createElement('div');
        dateLabel.className = 'date-label';
        dateLabel.textContent = date;

        const timeContainer = document.createElement('div');
        timeContainer.className = 'time-container hidden';

        dateMap[date].forEach((item) => {
          const timeEntry = document.createElement('div');
          timeEntry.className = 'time-entry';
          const time = item.start.split('T')[1].split('+')[0].split('.')[0];
          timeEntry.textContent = time;

          timeEntry.onclick = (e) => handleDeviceClick(e,item.url, index, 'playback');
          timeContainer.appendChild(timeEntry);
        });

        dropdownContainer.onclick = (e) => {
          e.stopPropagation();
          const isHidden = timeContainer.classList.contains('hidden');
          // Ensure all other timeContainers are hidden
          document.querySelectorAll('.time-container').forEach((el) => {
            el.classList.add('hidden');
          });
          // Toggle visibility of the clicked timeContainer
          if (isHidden) {
            timeContainer.classList.remove('hidden');
          } else {
            timeContainer.classList.add('hidden');
          }
        };

        dateDropdown.appendChild(dateLabel);
        dateDropdown.appendChild(timeContainer);
        dropdownContainer.appendChild(dateDropdown);
      });

      targetElement.appendChild(dropdownContainer);
    } catch (error) {
      console.error('Failed to fetch device data:', error);
    }
  };
  
  const handleDeviceClickWithSublist = (e,streamid,index) => {
    e.stopPropagation()
    fetchDeviceData(e.currentTarget,streamid,index);
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
  };

  const handleDeviceClick = (e,device, index,string) => {
    if(string === "stream"){
      e.stopPropagation()
      onDeviceSelected(device.secondarystream, index);
    }
    else{
      onDeviceSelected(device, index);
    }
  };

  return (
    <div className="event-list">
      <div className="tabs">
        {eventShow ? (
        <div
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          Events
        </div>

        ):(
        <></>
        )}
        <div
          className={`tab ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          Devices
        </div>
      </div>

      <div className="tab-content">
      <>
        {eventShow && activeTab === 'events' ? (
  <div className="events-list">
    {events.map((event, index) => {
      console.log(`Rendering EventCard #${index}`, event);

      return (
        <EventCard
          key={index}
          index={index}
          eventImage={event.eventImage}
          eventName={event.eventName}
          eventFullFrame={event.eventFullFrame}                              
          eventDate={event.eventTime}
          cameraName={event.eventId}
          eventOrgImage={event.eventOrgImage}
          eventType={event.eventType}
          eventRemark={event.eventRemark}
          eventParameters={event.eventParameters}
          eventAngles={event.eventAngles}
          onClick={() => handleEventClick(event)}
        />
      );
    })}

          </div>
        ) : (
          <></>
        )}
      </>

      {activeTab === 'devices' &&(

        <div className="devices-list">
            {loading ? (
              <p>Loading devices...</p>
            ) : (
              <ul>
                {devices.map((device, index) => (
                  <li key={device.streamid} className='playback-devicelist'>
                    {eventShow ? (
                      <div onClick={(e) => handleDeviceClick(e,device, index, 'stream')}>
                        <p style={{fontWeight:"bold"}}>{device.streamname}</p>
                      </div>
                    ) : (
                      <div onClick={(e) => handleDeviceClickWithSublist(e, device.streamid,index)}>
                        <p style={{fontWeight:"bold"}}>{device.streamname}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>

    {selectedEvent && (
      <Modal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    )}
    </div>
  );
};

const EventCard = ({ index, eventImage, eventName, eventDate, cameraName, eventOrgImage,eventType,eventRemark, onClick }) => {
//console.log(eventImage,eventName,eventDate,cameraName,"evebntData")
  const date = eventDate.split(" ")[0];
  const time = eventDate.split(" ")[1];
  console.log(date,time,"date and time");
  const defaultImage = "/assets/defaultImage.png";
  const alertSound = "/assets/alert.mp3"
  const backgroundColor = eventType === 'blacklist' ? 'red' : 'white';
  
  const audioRef = useRef(null); 
  const hasPlayedSound = useRef(false); 
  const lastPlayedTimeRef = useRef(0);

useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(alertSound);
    }

    if (index === 0 && eventType === "blacklist") {
      if (!hasPlayedSound.current || Date.now() - lastPlayedTimeRef.current > 2000) {
        console.log("Playing sound for blacklist event:", index);
        playAlertSound();
        hasPlayedSound.current = true; // Mark sound as played
      }
    } else {
      hasPlayedSound.current = false;
    }
  }, [index, eventType]); // Runs only when a new event appears


function playAlertSound() {
    const now = Date.now();

    // Prevent multiple sounds within 2 seconds
    if (now - lastPlayedTimeRef.current < 2000) return;

    lastPlayedTimeRef.current = now;
    audioRef.current.play().catch((error) => console.error("Error playing sound:", error));

    setTimeout(() => {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }, 2000);
  }

  function handleClick(event) {
    event.stopPropagation();
    if (onClick) onClick();
  }

  return (
      <div className= "event-card" onClick={handleClick} style={{backgroundColor}}>
      <img src={eventImage} alt="Event" className="event-image" style={{width:"90px", height:"90px"}}/>
      <div className="event-details">
        <h4 style={{overflow: "auto"}}>{eventName}</h4>
        <p>{date}</p>
        <p>{time}</p>
        <p>{cameraName}</p>
        <p>{eventRemark}</p>
      </div>
      <img src={eventOrgImage? eventOrgImage:defaultImage} alt="Event-Pic" className="event-original-image" style={{width:"90px", height:"90px"}}/>
    </div>
  );
};

const Modal = ({ event, onClose }) => {
console.log(event,"event")
  const [activeTab, setActiveTab] = useState('details');
  const [lastVideoData,setLastVideoData] = useState({})

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [onClose]);

  const handleClickOutside = (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      onClose();
    }
  };

  const handleVideoClick = async(eventId) => {
    setActiveTab("video");
    try {
      const response = await fetch(`${process.env.REACT_APP_PLAYBACK_URL}list?path=secondary${eventId}`);

      if (!response.ok) {
        console.error("Network response was not ok");
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        const lastObject = data[data.length - 1];
        setLastVideoData(lastObject);
      } else {
        console.error("No data available in the response.");
      }
    } catch (error) {
      console.error("Error fetching video data:", error);
    }
  }
  
  return (
    <div className="modal-backdrop" onClick={handleClickOutside}>
      <div className="modal-content">
        <span className="close-icon" onClick={onClose}>&times;</span>

        <div className="modal-tabs">
          <div
            className={`modal-tab ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Details
          </div>
        
          <div
            className={`modal-tab ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => handleVideoClick(event.eventId)}
          >
            Video
          </div>
        
        </div>

        <div className="modal-tab-content">
          {activeTab === 'details' && (
            <div className="details-tab">
              <div>
                <div className="details-info">
  <h2>{event.eventName}</h2>
  <p><strong>Date:</strong> {event.eventTime}</p>
  <p><strong>Type:</strong> {event.eventType?event.eventType:"Not Defined"}</p>
  <p><strong>Remark:</strong> {event.eventRemark?event.eventRemark:"Not Defined"}</p>

  {event.eventParameters?.attributes && Object.keys(event.eventParameters.attributes).length > 0 && (
  <div>
    <h4>Attributes:</h4>
    {Object.entries(event.eventParameters.attributes).map(([key, value], index) => {
      // Format the key nicely
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      // If value is an array like beard_glasses
      if (Array.isArray(value)) {
        return (
          <div key={index}>
            <p><strong>{formattedKey}:</strong></p>
            {value.length > 0 ? (
              <ul>
                {value.map((item, i) => (
                  <li key={i}>
                    {Array.isArray(item)
                      ? `${item[0]} (${(item[1] * 100).toFixed(1)}%)`
                      : item}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Not available</p>
            )}
          </div>
        );
      }

      // Show other values, or "Not available" if null/undefined
      return (
        <p key={index}>
          <strong>{formattedKey}:</strong> {value != null ? value.toString() : "Not available"}
        </p>
      );
    })}
  </div>
)}


  {event.eventAngles?.length === 3 && (
    <div>
      <h4>Angles:</h4>
      <p><strong>Yaw:</strong> {event.eventAngles[0].toFixed(2)}°</p>
      <p><strong>Pitch:</strong> {event.eventAngles[1].toFixed(2)}°</p>
      <p><strong>Roll:</strong> {event.eventAngles[2].toFixed(2)}°</p>
    </div>
  )}
</div>

<div className='details-container'>
  <div>
    <img src={event.eventImage} alt={event.eventName} className="details-image" />
  </div>
  <div>
    <img src={event.eventFullFrame} alt={event.eventName + " full frame"} className='details-image' />
  </div>
</div>
       
              </div>
            </div>
          )}
         
          {activeTab === 'video' && (
            <div className="video-tab">
              <VideoCapture videoUrl={lastVideoData.url} /> 
            </div>
          )}
           
        </div>
      </div>
    </div>
  );
};

export default EventList;

