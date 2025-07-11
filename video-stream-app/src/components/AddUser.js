import React, { useState, useEffect, useRef } from 'react';
import { GridComponent, ColumnsDirective, ColumnDirective, Page, Sort, Inject } from '@syncfusion/ej2-react-grids';
import { TextBoxComponent } from '@syncfusion/ej2-react-inputs';
import { ButtonComponent } from "@syncfusion/ej2-react-buttons";
// import { DropDownListComponent } from "@syncfusion/ej2-react-dropdowns";
import { FormValidator } from '@syncfusion/ej2-inputs';
import Menu from './Menu';
import './Login.css'; 
import './ManageFaces.css';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import CryptoJS from 'crypto-js';
import Footer from './Footer';
import Layout from './Layout';

const AddUser = () => {
    const [userData, setUserData] = useState([]);
    const [name, setName] = useState('');
    const [email, setEmail] = useState(''); // New email field
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [authData, setAuthData] = useState(null);
    const [xsrfToken, setXsrfToken] = useState("");
    const [errorMessage, setErrorMessage] = useState(null);
    const gridRef = useRef(null);
    const navigate = useNavigate();

    const roles = ['Admin', 'User'];
    const formObject = React.useRef(null);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const authData = await ValidateAuth();
                if (!authData || authData.user.role !== 'SuperAdmin') {
                    navigate('/login');
                } else {
                    setAuthData(authData.user);
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

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/getUsers`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                });

                if (response.ok) {
                    const data = await response.json();
                    setUserData(data);
                } else {
                    throw new Error('Failed to fetch user data');
                }
            } catch (error) {
                console.error('Error fetching user data:', error);
            }
        };
        fetchUserData();
    }, []);

    useEffect(() => {
        if (gridRef.current) {
            console.log('Updating Grid Data Source');
            gridRef.current.dataSource = userData;
        }
    }, [userData]);

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        const formData = { name, email, username, password, role }; // Include email in form data
        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': xsrfToken,
                },
                body: JSON.stringify(formData),
                credentials: 'include',
            });

            if (response.ok) {
                const newUser = await response.json();
                setUserData((prevData) => [...prevData]);
                setName('');
                setEmail(''); // Clear email field
                setUsername('');
                setPassword('');
                setRole('');
                // setShowForm(false);
            } else {
                console.error('Failed to add user');
            }
        } catch (error) {
            console.error('Error adding user:', error);
        }
    };

    const deleteRow = async (username) => {
        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/deleteUser`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username }),
                credentials: 'include',
            });

            if (response.ok) {
                setUserData((prevData) => prevData.filter((row) => row.username !== username));
            } else {
                throw new Error('Failed to delete user');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
        }
    };

    const validationRules = {
        name: {
            required: [true, "Name is required"],
            regex: [
                /^[a-zA-Z\s]+$/,
                "Name can only contain letters and spaces",
            ],
        },
        email: {
            required: [true, "Email is required"],
            regex: [
                /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                "Invalid email format",
            ],
        },
        username: {
            required: [true, "Username is required"],
            regex: [
                /^[a-zA-Z0-9@._-]+$/,
                "Username can only contain letters, numbers, and special characters (@, ., _, -)",
            ],
            minLength: [3, "Username must be at least 3 characters long"],
        },
        password: {
            required: [true, "Password is required"],
            minLength: [8, "Password must be at least 8 characters long"],
            regex: [
                /^[a-zA-Z0-9@#\-_.!$%^&*]+$/,
                "Password can only contain letters, numbers, and special characters (@, #, -, _, ., !, $, %, ^, &, *)",
            ],
        },
    };

    return (
    <Layout>
        <div>
            <header className="header-menu">
                <Menu />
            </header>
            {!showForm ? (
                <div className="userTableContainer">
                    <h2>Manage Users</h2>
                    <GridComponent
                        ref={gridRef}
                        dataSource={userData}
                        allowPaging={true}
                        allowSorting={true}
                        pageSettings={{ pageSize: 5 }}
                    >
                        <ColumnsDirective>
                            <ColumnDirective field="name" headerText="Name" width="200" textAlign="Center" />
                            <ColumnDirective field="username" headerText="Username" width="200" textAlign="Center" />
                            <ColumnDirective field="role.name" headerText="Role" width="150" textAlign="Center" />
                            <ColumnDirective
                                field="role.rights"
                                headerText="Rights"
                                width="200"
                                textAlign="Center"
                                template={(rowData) => {
                                    const enabledRights = rowData.role.rights
                                        .filter(right => right.enabled)
                                        .map(right => right.name)
                                        .join(", ");
                                    return <span>{enabledRights}</span>;
                                }}
                            />
                            <ColumnDirective
                                field="actions"
                                headerText="Actions"
                                width="150"
                                textAlign="Center"
                                template={(rowData) => (
                                    <button
                                        onClick={() => deleteRow(rowData.username)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: 'red',
                                            fontSize: '18px',
                                        }}
                                        title="Delete"
                                    >
                                        <i className="fa fa-trash" aria-hidden="true"></i>
                                    </button>
                                )}
                            />
                        </ColumnsDirective>
                        <Inject services={[Page, Sort]} />
                    </GridComponent>
                    <div className="button-container">
                        <button
                            type="button"
                            className="addUserButton"
                            onClick={() => setShowForm(true)}
                        >
                            Add User
                        </button>
                    </div>
                </div>
            ) : (
                <div className="addUserFormContainer">
                    <h2 style={{ color: "white" }}>Add User</h2>
                    <form
                        onSubmit={handleFormSubmit}
                        ref={(form) => {
                            if (form && !formObject.current) {
                                formObject.current = new FormValidator(form, {
                                    rules: validationRules,
                                });
                            }
                        }}
                    >
                        <div>
                            <label htmlFor="name">Full Name:</label>
                            <TextBoxComponent
                                id="name"
                                name="name"
                                value={name}
                                change={(e) => setName(e.value)}
                                placeholder="Enter full name"
                            />
                        </div>

                        <div>
                            <label htmlFor="email">Email:</label> {/* Email Field */}
                            <TextBoxComponent
                                id="email"
                                name="email"
                                value={email}
                                change={(e) => setEmail(e.value)}
                                placeholder="Enter email"
                            />
                        </div>

                        <div>
                            <label htmlFor="username">Username:</label>
                            <TextBoxComponent
                                id="username"
                                name="username"
                                value={username}
                                change={(e) => setUsername(e.value)}
                                placeholder="Enter username"
                            />
                        </div>

                        <div>
                            <label htmlFor="password">Password:</label>
                            <TextBoxComponent
                                id="password"
                                name="password"
                                type="password"
                                value={password}
                                change={(e) => setPassword(e.value)}
                                placeholder="Enter password"
                            />
                        </div>

                        <div>
                            <label htmlFor="role">Role:</label>
                            <select
                                id="role"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                required
                            >
                                <option value="">Select Role</option>
                                {roles.map((roleOption, idx) => (
                                    <option key={idx} value={roleOption}>
                                        {roleOption}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button type="submit">Submit</button>
                        <button type="button" onClick={() => setShowForm(false)}>
                            Show Table
                        </button>
                    </form>
                </div>
            )}
            
        </div>
        </Layout>
    );
};

export default AddUser;

