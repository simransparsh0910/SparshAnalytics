import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import "./Login.css";

const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [message, setMessage] = useState('');
    const [otpFieldVisible, setOtpFieldVisible] = useState(false);
    const [isButtonDisabled, setIsButtonDisabled] = useState(false);
    const [timer, setTimer] = useState(0);
    const [loading, setLoading] = useState(false); // Loading state
    const navigate = useNavigate();

    useEffect(() => {
        let interval;
        if (isButtonDisabled && timer > 0) {
            interval = setInterval(() => {
                setTimer((prevTimer) => prevTimer - 1);
            }, 1000);
        } else if (timer === 0) {
            setIsButtonDisabled(false);
        }

        return () => clearInterval(interval);
    }, [isButtonDisabled, timer]);

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setLoading(true); // Start loading

        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
    
            const data = await response.json();
            setMessage(data.message || "If the email is registered, a reset link has been sent.");

            if (response.ok) {
                setOtpFieldVisible(true); // Show OTP field if email is sent successfully
                setIsButtonDisabled(true); // Disable the button
                setTimer(60); // Set timer to 60 seconds
                setOtp(""); // Clear OTP field
            }
        } catch {
            setMessage("An error occurred. Please try again later.");
        } finally {
            setLoading(false); // Stop loading
        }
    };

    const handleOtpSubmit = async (e) => {
        e.preventDefault();

        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/validate-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });

            const data = await response.json();
            setMessage(data.message || "OTP validation complete.");

            if (response.ok) {
                navigate('/reset-password', { state: { email } });
            }
        } catch {
            setMessage("An error occurred during OTP validation. Please try again.");
        }
    };

    return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Forgot Password</h2>
            <form onSubmit={handleForgotPassword} className="forgotPass-form">
                <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ marginBottom: '10px', padding: '5px', width: '300px' }}
                    disabled={otpFieldVisible} // Disable email input once OTP is sent
                />
                <button 
                    type="submit" 
                    style={{ padding: '5px 15px' }} 
                    disabled={isButtonDisabled || loading}>
                    {loading ? "Sending..." : isButtonDisabled ? `Send Again (${timer}s)` : "Send Reset Link"}
                </button>
                <div className="login-link" style={{ marginTop: '10px' }}>
                    <Link className="login-link" to="/login">Login?</Link>
                </div>
            </form>

            {otpFieldVisible && (
                <div style={{ marginTop: '20px' }}>
                    <input
                        type="text"
                        placeholder="Enter OTP"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        required
                        style={{ marginBottom: '10px', padding: '5px', width: '300px' }}
                    />
                    <button onClick={handleOtpSubmit} style={{ padding: '5px 15px' }}>Verify OTP</button>
                </div>
            )}

            {message && <p style={{ marginTop: '10px', color: otpFieldVisible ? 'blue' : 'green' }}>{message}</p>}
        </div>
    );
};

export default ForgotPassword;

