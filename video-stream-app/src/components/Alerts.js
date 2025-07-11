import React from "react";
import Menu from './Menu';
import './Alerts.css'; // Importing CSS
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

const AlertsDashboard = () => {
  const alertsData = [
    {
      id: 1,
      label: "Alerts Delivered",
      value: 345,
      icon: "🚨",
      bgColor: "bg-white",
      textColor: "text-red-600"
    },
    {
      id: 2,
      label: "Total Analytics Active",
      value: 8,
      icon: "📊",
      bgColor: "bg-white",
      textColor: "text-blue-600"
    },
    {
      id: 3,
      label: "Peak Alert Time",
      value: "2 PM",
      icon: "⏰",
      bgColor: "bg-white",
      textColor: "text-green-600"
    },
    {
    id: 4,
    label: "Off-Peak Alert Time",
    value: "4 AM",
    icon: "🌙",
    bgColor: "bg-blue-100",
    textColor: "text-blue-600"
  },
  {
    id: 5,
    label: "Cameras Active",
    value: 48,
    icon: "📷",
    bgColor: "bg-yellow-100",
    textColor: "text-yellow-600"
  },
  {
    id: 6,
    label: "Areas",
    value: 7,
    icon: "🗺️",
    bgColor: "bg-green-100",
    textColor: "text-green-600"
  }
  ];

  const severityData = [
    {
      id: 1,
      label: "High Severity Alerts",
      value: 345,
      icon: "🚨",
      bgColor: "bg-white",
      textColor: "text-red-600"
    },
    {
      id: 2,
      label: "Medium Severity Alerts",
      value: 246,
      icon: "⏰",
      bgColor: "bg-white",
      textColor: "text-green-600"
    },
    {
      id: 3,
      label: "Low Severity Alerts",
      value: 8,
      icon: "📊",
      bgColor: "bg-white",
      textColor: "text-blue-600"
    },
    
  ];

  const data = [
  { name: "Mon", AlertA: 30, AlertB: 20, AlertC: 15 },
  { name: "Tue", AlertA: 40, AlertB: 25, AlertC: 20 },
  { name: "Wed", AlertA: 45, AlertB: 30, AlertC: 22 },
  { name: "Thu", AlertA: 35, AlertB: 48, AlertC: 18 },
  { name: "Fri", AlertA: 50, AlertB: 32, AlertC: 25 },
  { name: "Sat", AlertA: 55, AlertB: 40, AlertC: 30 },
  { name: "Sun", AlertA: 60, AlertB: 38, AlertC: 28 }
  ];

  const recentEvents = Array.from({ length: 6 }, (_, index) => ({
    id: index,
    label: "Too Much Crowd Detected",
    imageUrl:
      "https://via.placeholder.com/300x200.png?text=Crowd+Detected"
  }));

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="header-menu">
        <Menu />
      </header>

      <div className="p-4">
        <div className="page_container">
          <div className="total_alertEvent_section">
            {/* Total Alerts Section */}
            <div className="total_alert_section">
              <div className="alerts_container">
                <div className="grid">
                  {alertsData.map((item) => (
                    <div key={item.id} className={`alert-tile ${item.bgColor}`}>
                      <div className="icon">{item.icon}</div>
                      <div>
                        <h2 className={item.textColor}>{item.value}</h2>
                        <p>{item.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="severity_container">
                <div className="grid">
                  {severityData.map((item) => (
                    <div key={item.id} className={`alert-tile ${item.bgColor}`}>
                      <div className="icon">{item.icon}</div>
                      <div>
                        <h2 className={item.textColor}>{item.value}</h2>
                        <p>{item.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Events Section */}
            <div className="event_container">
              <h3>Recent Events</h3>
              <div className="grid">
                {recentEvents.map((event) => (
                  <div key={event.id}>
                    <img
                      src={event.imageUrl}
                      alt={event.label}
                    />
                    <p>{event.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Placeholder for Chart */}
          <div className="bottom_section">
            <div className="map-container">
              <h3>Map View</h3>
              <div className="placeholder">
                <iframe
                  src="https://maps.google.com/maps?q=India&t=&z=5&ie=UTF8&iwloc=&output=embed"
                  width="100%"
                  height="300"
                  style={{ border: 0 }}
                  allowFullScreen=""
                  loading="lazy"
                  title="Map"
                ></iframe>
              </div>
            </div>
            <div className="analytics-graph">
              <h3>Analytics Graph</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="AlertA" stroke="#8884d8" strokeWidth={2} />
                  <Line type="monotone" dataKey="AlertB" stroke="#82ca9d" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>

  );
};

export default AlertsDashboard;
