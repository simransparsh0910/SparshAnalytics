export const ValidateAuth = async () => {
    try {
        const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/validate`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });
        //console.log(response);
        if (response.status === 200) {
            const data = await response.json();
            return data;
        }

        throw new Error('User is not authenticated');
    } catch (error) {
        console.error('Authentication error:', error.message);
        return null;
    }
};
