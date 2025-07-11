import React, { useState, useEffect, useRef } from 'react';
import { TextBoxComponent } from '@syncfusion/ej2-react-inputs';
import { ButtonComponent } from "@syncfusion/ej2-react-buttons";
import Menu from './Menu';
import './ManageRoles.css'; 
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import { FormValidator } from '@syncfusion/ej2-inputs';
import Footer from './Footer';
import Layout from './Layout';

const ManageRoles = () => {
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newRoleName, setNewRoleName] = useState('');
    const [newRoleRights, setNewRoleRights] = useState({});
    const navigate = useNavigate();
    const [xsrfToken, setXsrfToken] = useState("");
    const [errorMessage, setErrorMessage] = useState(null);
    const formObject = React.useRef(null);
    const allRights = [
        'Add Face',
        'Delete Face',
        'Add Camera',
        'Delete Camera',
        'Show Playback',
    ];

    useEffect(() => {
      const checkAuth = async () => {
        try {
          const authData = await ValidateAuth();
          if (!authData || authData.user.role !== "SuperAdmin") {
            navigate('/login');
          }
        } catch (error) {
          console.error('Error validating auth:', error);
          navigate('/login');
        }
      };
      checkAuth();
    }, []);

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
    

    // Fetch roles except Admin
    useEffect(() => {
        const fetchRoles = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/roles`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (response.ok) {
                    const data = await response.json();
                    const populatedRoles = data.map((role) => ({
                        ...role,
                        rights: allRights.map((right) => {
                            const existingRight = role.rights.find((r) => r.name === right);
                            return {
                                name: right,
                                enabled: existingRight ? existingRight.enabled : false,
                            };
                        }),
                    }));
                    setRoles(populatedRoles);
                } else {
                    throw new Error('Failed to fetch roles');
                }
            } catch (error) {
                console.error('Error fetching roles:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchRoles();
    }, []);

    const handleRightToggle = (roleId, rightName) => {
        setRoles((prevRoles) =>
            prevRoles.map((role) =>
                role._id === roleId
                    ? {
                          ...role,
                          rights: role.rights.map((right) =>
                              right.name === rightName
                                  ? { ...right, enabled: !right.enabled }
                                  : right
                          ),
                      }
                    : role
            )
        );
    };

    const handleSave = async () => {
        try {
            const payload = roles.map((role) => ({
                id: role._id,
                rights: role.rights.map((right) => ({
                    name: right.name,
                    enabled: right.enabled,
                })),
            }));

            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/roles/update-rights`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': xsrfToken,
                },
                body: JSON.stringify({ roles: payload }),
            });

            if (!response.ok) {
                throw new Error('Failed to update roles');
            }

            console.log('Roles updated successfully');
        } catch (error) {
            console.error('Error updating roles:', error);
        }
    };

    const handleAddRole = async (e) => {
        e.preventDefault();
        // if (formObject.current.validate()) {
            try {
                const rights = allRights.map((right) => ({
                    name: right,
                    enabled: newRoleRights[right] || false,
                }));

                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/roles`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': xsrfToken,
                    },
                    body: JSON.stringify({ name: newRoleName, rights }),
                });

                if (!response.ok) {
                    throw new Error('Failed to add role');
                }

                const newRole = await response.json();
                setRoles((prevRoles) => [...prevRoles, newRole.role]);
                setShowForm(false); 
                setNewRoleName('');
                setNewRoleRights({});
            } catch (error) {
                console.error('Error adding role:', error);
            }
        // }
    };

    const handleToggleRight = (rightName) => {
        setNewRoleRights((prevRights) => ({
            ...prevRights,
            [rightName]: !prevRights[rightName],
        }));
    };

    if (loading) {
        return <div className="loading">Loading roles...</div>;
    }
    
    const roleValidationRules = {
        roleName: {
          required: [true, "Role Name is required"],
          regex: [
            /^[a-zA-Z0-9\s]+$/,
            "Role Name can only contain letters, numbers, and spaces",
          ],
          minLength: [3, "Role Name must be at least 3 characters long"],
          maxLength: [20, "Role Name cannot exceed 20 characters"],
        },
        
    };

    return (
    <Layout>
        <div className="manage-roles">
            <header className="header-menu">
                <Menu />
            </header>
            <div className="container">
                <h2>Manage Roles</h2>

                {showForm ? (
                    <form
                    onSubmit={handleAddRole}
                    className="form-container"
                    ref={(form) => {
                      if (form && !formObject.current) {
                        formObject.current = new FormValidator(form, {
                          rules: roleValidationRules,
                        });
                      }
                    }}
                  >
                    <div className="form-group">
                      <label htmlFor="newRoleName">Role Name:</label>
                      <TextBoxComponent
                        id="roleName"
                        value={newRoleName}
                        change={(e) => setNewRoleName(e.value)}
                        placeholder="Enter Role Name"
                        cssClass="form-field"
                      />
                    </div>
              
                    <div className="form-group">
                            <h4>Assign Rights:</h4>
                            <div className="rights-container">
                                {allRights.map((right) => (
                                    <div key={right} className="right-item">
                                        <input
                                            type="checkbox"
                                            checked={newRoleRights[right] || false}
                                            onChange={() => handleToggleRight(right)}
                                        />
                                        <label>{right}</label>
                                    </div>
                                ))}
                            </div>
                        </div>
              
                    <button type="submit" className="btn-primary">
                            Submit
                        </button>
                    </form>
                ) : (
                    roles.map((role) => (
                        <div key={role._id} className="role-container">
                            <h3>{role.name}</h3>
                            <div className="rights-container">
                                {allRights.map((right) => {
                                    const existingRight = role.rights.find((r) => r.name === right);
                                    return (
                                        <div key={right} className="right-item">
                                            <input
                                                type="checkbox"
                                                checked={existingRight ? existingRight.enabled : false}
                                                onChange={() => handleRightToggle(role._id, right)}
                                            />
                                            <label>{right}</label>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
                <div className="save-btn">
                    {!showForm && (
                        <button onClick={() => setShowForm(true)} className="btn-primary">
                            Add Role
                        </button>
                    )}
                    {showForm && (
                        <button onClick={() => setShowForm(false)} className="btn-secondary">
                            Show Data
                        </button>
                    )}
                    {!showForm && (
                        <button onClick={handleSave} className="btn-primary">
                            Save Changes
                        </button>

                    )}
                </div>
            </div>
           
        </div>
        </Layout>
    );
};

export default ManageRoles;
