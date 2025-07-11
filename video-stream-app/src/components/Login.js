import React, { useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';
import { FormValidator } from '@syncfusion/ej2-inputs';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { useNavigate } from 'react-router-dom';
//import CaptchaComponent from './CaptchaForm'; // Import Captcha Component
import { Link } from 'react-router-dom';
import "./Login.css";

const LoginPage = ({setSessionId,setXsrfToken,xsrfToken}) => {
    const formObject = React.useRef(null);
    const [captcha, setCaptcha] = useState(''); // Store CAPTCHA image
    const [userCaptcha, setUserCaptcha] = useState(''); // Store user-entered CAPTCHA
    const [errorMessage, setErrorMessage] = useState(null);
    const navigate = useNavigate();
    const [isShown, setIsShown] = useState(false);

    const togglePassword = (setSessionId) => {
        setIsShown((prevState) => !prevState);
    };

    useEffect(() => {
        async function setCSRFToken() {
            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/login`, {
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
        async function fetchCaptcha() {
            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/generate-captcha`);
                if (response.ok) {
                    const svgCaptcha = await response.text();
                    setCaptcha(svgCaptcha);
                } else {
                    console.error('Failed to fetch CAPTCHA');
                }
            } catch (error) {
                console.error('Error fetching CAPTCHA:', error);
            }
        }
        fetchCaptcha();
    }, []);

    const getCsrfToken = () => {
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        return match ? match[1] : null;
    };

    const encrypt = (data, secret) => {
        return CryptoJS.AES.encrypt(data, secret).toString();
    };

    const secretKey = "IZOia7Nvb3UTYdV+s8SOw0fA1qiecbEvgbFVmjdxFrvhEotmFdCa4U2tmX38WKPU";
    const handleFormSubmit = async (event) => {
        event.preventDefault();

        // Ensure CAPTCHA validation is successful before proceeding
       // if (!isCaptchaValid) {
         //   setErrorMessage("Please validate the CAPTCHA before submitting.");
           // return;
       // }

        if (formObject.current.validate()) {
            const encryptedUsername = encrypt(event.target.username.value, secretKey);
            const encryptedPassword = encrypt(event.target.password.value, secretKey);
            const formData = {
                username: encryptedUsername,
                password: encryptedPassword,
                userCaptcha
            };

            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': xsrfToken,
                    },
                    body: JSON.stringify(formData),
                    credentials: 'include',
                });

                if (response.ok) {
                console.log(response,"res");
                    const data = await response.json();
                    //console.log("session",data)
                    setSessionId(data.sessionId);
                    navigate("/dashboard");
                } else {
                    const errorData = await response.json();
                    setErrorMessage(errorData.message);
                }
            } catch (error) {
                if (error instanceof TypeError) {
                console.log(error,"error")
                    setErrorMessage(`Failed to connect to the server. Please try again later.${error}`);
                } else {
                    setErrorMessage("An unexpected error occurred.");
                }
            }

            event.target.reset();
        }
    };

    const validationRules = {
        username: { required: [true, "Username is required"] },
        password: { required: [true, "Password is required"] },
    };

    return (
        <div className="login-form-container" style={{ height: "100vh" }}>
            <form
                id="loginForm"
                onSubmit={handleFormSubmit}
                ref={(form) => {
                    if (form && !formObject.current) {
                        formObject.current = new FormValidator(form, { rules: validationRules });
                    }
                }}
            >
                <h2>LOGIN</h2>
                <div className="form-group">
                    <input
                        name="username"
                        type="text"
                        placeholder="Username"
                        className="input input-username"
                    />
                </div>

                <div className="form-group">
                    <input
                        name="password"
                        type={isShown ? "text" : "password"}
                        placeholder="Password"
                        className="input input-password"
                    />
                </div>
                
                <div className="form-group">
                    <label>Enter CAPTCHA:</label>
                    <div dangerouslySetInnerHTML={{ __html: captcha }} />
                    <input
                        type="text"
                        name="userCaptcha"
                        placeholder="Enter CAPTCHA"
                        value={userCaptcha}
                        onChange={(e) => setUserCaptcha(e.target.value)}
                        className="input input-captcha"
                        style={{ width: "100%", border: "none", borderBottom: "1px solid black", borderRadius: "0px", outline: "none", }}
                        required
                    />
                </div>

                
                <div className="link-container">
                 <div className="checkbox-container">
                    <label htmlFor="checkbox">Show password?</label>
                    <input
                        id="checkbox"
                        type="checkbox"
                        checked={isShown}
                        onChange={togglePassword}
                    />
                 </div>
                 <div className="forgot-password-link" style={{ marginTop: '10px' }}>
                    <Link className="forgot-link" to="/forgot-password">Forgot Password?</Link>
                 </div>
                </div>
               
                {errorMessage && (
                    <div className="error-message" style={{ color: 'red', marginBottom: '10px' }}>
                        {errorMessage}
                    </div>
                )}

                <ButtonComponent type="submit" cssClass="e-primary login-btn">Login</ButtonComponent>
            </form>
        </div>
    );
};

export default LoginPage;

