import React, { useState, useRef, useEffect } from 'react';
import './Config.css';
import Menu from './Menu'; // assuming you have a Menu component

const Config = () => {
  const classNames = Array.from({ length: 100 }, (_, i) => `Class ${i}`);
  const [selectedIndexes, setSelectedIndexes] = useState([]);
  const [attributes, setAttributes] = useState("no");
  const [apiUrl, setApiUrl] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef(null);

  const toggleClass = (index) => {
    setSelectedIndexes((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const config = {
      zmq: {
        publisher: {
          address: "tcp://backend:5000",
          main_address: "tcp://192.168.1.203:5000",
        },
        subscriber: {
          address_VA: "tcp://analytics_backend:5010",
          address_FRS: "tcp://analytics_backend:5020",
        },
      },
      data: {
        intrusion_classes: selectedIndexes,
        path_VA: "app/virtual_analytics",
        path_FRS: "app/face_recognition",
        port: "127.0.0.1",
        attributes: attributes,
      },
      api: {
        url: apiUrl,
      },
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "config.json";
    link.click();
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div>
      <header className="header-menu">
        <Menu />
      </header>
      <div className="config-form-container">
        <h2>Intrusion Configuration</h2>
        <form onSubmit={handleSubmit} className="config_form">
          <div className="config-form-group" ref={dropdownRef}>
            <label>Intrusion Classes</label>
            <div
              className="custom-select"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <div className="selected-values">
                {selectedIndexes.length > 0
                  ? selectedIndexes.map((i) => classNames[i]).join(", ")
                  : "Select Intrusion Classes"}
              </div>
            </div>
            {dropdownOpen && (
              <div
                className="dropdown-options"
                onClick={(e) => e.stopPropagation()} // prevent toggle on inner click
              >
                {classNames.map((name, index) => (
                  <label key={index}>
                    <input
                      type="checkbox"
                      checked={selectedIndexes.includes(index)}
                      onChange={() => toggleClass(index)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="config-form-group">
            <label>Attributes</label>
            <label>
              <input
                type="radio"
                value="yes"
                checked={attributes === "yes"}
                onChange={(e) => setAttributes(e.target.value)}
              />
              Yes
            </label>
            <label>
              <input
                type="radio"
                value="no"
                checked={attributes === "no"}
                onChange={(e) => setAttributes(e.target.value)}
              />
              No
            </label>
          </div>

          <div className="config-form-group">
            <label>API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="Enter API URL"
            />
          </div>

          <button type="submit" className="submit-button">
            Download config.json
          </button>
        </form>
      </div>
    </div>
  );
};

export default Config;
