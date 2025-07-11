import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import "./Login.css";
import { Link } from 'react-router-dom';

const ResetPassword = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const { state } = useLocation(); 
    const navigate = useNavigate();

    const handleResetPassword = async (e) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            setMessage("Passwords do not match.");
            return;
        }

        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: state.email, password }),
            });

            const data = await response.json();
            setMessage(data.message || "Password reset successful.");

            if (response.ok) {
                navigate('/login');
            }
        } catch {
            setMessage("An error occurred. Please try again.");
        }
    };

    return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Reset Password</h2>
            <form onSubmit={handleResetPassword} className="resetPass-form">
                <input
                    type="password"
                    placeholder="New Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ marginBottom: '10px', padding: '5px', width: '300px' }}
                />
                <input
                    type="password"
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    style={{ marginBottom: '10px', padding: '5px', width: '300px' }}
                />
                <button type="submit" style={{ padding: '5px 15px' }}>Reset Password</button>
                <div className="login-link" style={{ marginTop: '10px' }}>
                    <Link className="login-link" to="/login">Login?</Link>
                </div>
            </form>
            {message && <p style={{ marginTop: '10px', color: 'red' }}>{message}</p>}
        </div>
    );
};

export default ResetPassword;

