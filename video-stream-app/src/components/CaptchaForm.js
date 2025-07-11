import React, { useState, useEffect } from 'react';

const CaptchaForm = () => {
    const [captchaImage, setCaptchaImage] = useState('');
    const [userCaptcha, setUserCaptcha] = useState('');
    const [message, setMessage] = useState('');

    // Fetch CAPTCHA image from the backend
    const fetchCaptcha = async () => {
        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/generate-captcha`);
            const data = await response.json();
            setCaptchaImage(data.image); // Set the CAPTCHA image
        } catch (error) {
            console.error('Error fetching CAPTCHA:', error);
        }
    };

    // Load CAPTCHA on component mount
    useEffect(() => {
        fetchCaptcha();
    }, []);

    // Handle form submission
    const handleSubmit = async (event) => {
        event.preventDefault();

        try {
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/validate-captcha`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userCaptcha }),
            });

            const data = await response.json();
            setMessage(data.message);
            fetchCaptcha(); // Refresh CAPTCHA
            setUserCaptcha(''); // Clear user input
        } catch (error) {
            console.error('Error validating CAPTCHA:', error);
            setMessage('An error occurred during CAPTCHA validation.');
        }
    };

    return (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <form onSubmit={handleSubmit}>
                <div>
                    {captchaImage ? (
                        <img src={`data:image/svg+xml;base64,${captchaImage}`} alt="CAPTCHA" />
                    ) : (
                        <p>Loading CAPTCHA...</p>
                    )}
                </div>
                <input
                    type="text"
                    placeholder="Enter CAPTCHA"
                    value={userCaptcha}
                    onChange={(e) => setUserCaptcha(e.target.value)}
                    required
                />
                <button type="submit">Submit</button>
            </form>
            {message && <p>{message}</p>}
        </div>
    );
};

export default CaptchaForm;

