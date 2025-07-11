import React, { useState, useEffect } from 'react';
import Menu from './Menu';

const Setting = () => {
  // const [isCaptureEnabled, setIsCaptureEnabled] = useState(false);
  const [autoEnrollment, setAutoEnrollment] = useState(false);
  const [catName, setCatName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [remark, setRemark] = useState("");
  const [categories, setCategories] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState("");

  useEffect(() => {
    const fetchToggle = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/get-toggle-capture`);
        const result = await response.json();
        setAutoEnrollment(result.status);
      } catch (err) {
        console.error("Error fetching capture toggle:", err);
      }
    };
    fetchToggle();
  }, []);

  useEffect(() => {
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

  // const handleToggleCapture = async (e) => {
  //   const checked = e.target.checked;
  //   setIsCaptureEnabled(checked);

  //   try {
  //     await fetch(`${process.env.REACT_APP_SERVER_URL}/toggle-capture`, {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ enabled: checked }),
  //     });
  //   } catch (err) {
  //     console.error("Error toggling capture:", err);
  //   }
  // };

  const handleSubmitCategory = async () => {
    if (!catName.trim() || !threshold.trim() || !remark.trim()) {
      alert("All fields are required.");
      return;
    }

    const payload = {
      name: catName,
      threshold: Number(threshold),
      remark: remark,
    };

    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const newCategory = await response.json();
      setCategories((prev) => [...prev, newCategory]);
      setCatName("");
      setThreshold("");
      setRemark("");
      alert("Category added successfully.");
    } catch (err) {
      console.error("Error submitting category:", err);
    }
  };

  const handleFinalSubmit = async () => {
    if (!selectedGroup) {
      alert("Please select a category before submitting.");
      return;
    }

    const payload = {
      autoEnrollment: true,
      category: selectedGroup,
    };

    try {
      const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/toggle-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Enrollment failed");

      const result = await response.json();
      console.log("Enrollment response:", result);
      alert("Enrollment successful!");
    } catch (err) {
      console.error("Error during enrollment:", err);
      alert("Enrollment failed.");
    }
  };

  const handleToggleAutoEnrollment = async (checked) => {
    setAutoEnrollment(checked);
  
    if (!checked) {
      try {
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/toggle-capture-disable`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoEnrollment: false }),
        });
  
        if (!response.ok) throw new Error("Disabling enrollment failed");
  
        const result = await response.json();
        console.log("Auto Enrollment Disabled:", result);
        alert("Auto enrollment has been disabled.");
      } catch (err) {
        console.error("Error disabling auto enrollment:", err);
        alert("Failed to disable auto enrollment.");
      }
    }
  };
  

  return (
    <div style={{ background: '#fff', padding: '2rem', minHeight: '100vh', color: '#333' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <Menu />
      </header>

      <h2 style={{ color: '#FF7F50', marginBottom: '1.5rem' }}>Settings</h2>

      {/* <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={isCaptureEnabled}
            onChange={handleToggleCapture}
          />
          Capture Live Face
        </label>
      </div> */}

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={autoEnrollment}
            onChange={(e) => handleToggleAutoEnrollment(e.target.checked)}
          />
          Enable Auto Enrollment
        </label>
      </div>

      {autoEnrollment && (
        <>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '1rem',
              backgroundColor: '#f9f9f9',
              maxWidth: '400px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              marginBottom: '1rem'
            }}
          >
            <input
              type="text"
              placeholder="Category Name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="number"
              placeholder="Threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              style={inputStyle}
            />
            <button onClick={handleSubmitCategory} style={buttonStyle}>
              Add Category
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
            <label htmlFor="group">Select Category:</label>
            <select
              id="group"
              name="group"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Choose Category --</option>
              {categories.map((cat) => (
                <option key={cat._id} value={cat.name}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <button
            style={{ ...buttonStyle, width: "fit-content" }}
            onClick={handleFinalSubmit}
          >
            Submit Enrollment
          </button>
        </>
      )}
    </div>
  );
};

const inputStyle = {
  padding: '0.6rem',
  border: '1px solid #ccc',
  borderRadius: '5px',
  fontSize: '1rem',
  width: '100%'
};

const buttonStyle = {
  padding: '0.7rem 1.5rem',
  backgroundColor: '#FF7F50',
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  fontWeight: 'bold',
  cursor: 'pointer'
};

export default Setting;
