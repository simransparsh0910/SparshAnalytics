import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const Logout = ({setSessionId,sessionId}) => {
    const navigate = useNavigate();
    const hasLoggedOut = useRef(false); // Ref to track if logout has already been performed
    useEffect(() => {
        const performLogout = async () => {
            if (hasLoggedOut.current) {
                return;
            }
            hasLoggedOut.current = true;

            try {
                const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/logout`, {
                    method: 'POST',
                     headers: {
                        'Authorization': `Session ${sessionId}`,
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                });

                if (response.ok) {
                    console.log('Logged out successfullyy');
                    navigate('/login');
                } else {
                    console.error('Failed to log out');
                    navigate('/login');
                }
            } catch (error) {
                console.error('Error during logout:', error);
            }
        };

        performLogout();
    }, [navigate]);

    return null;
};

export default Logout;
