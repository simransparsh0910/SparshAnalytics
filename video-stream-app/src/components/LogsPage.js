import React, { useState, useEffect } from 'react';
import Pagination from './Pagination';
import Menu from './Menu';
import { ValidateAuth } from '../ValidateAuth';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout';

const LogsPage = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const navigate = useNavigate();
    const itemsPerPage = 50;
    const [error, setError] = useState(null);
    
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
    
    // Fetch logs based on the current page
    const fetchLogs = async (page = 1) => {
        try {
            setLoading(true);
            const response = await fetch(`${process.env.REACT_APP_SERVER_URL}/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ page, itemsPerPage }),
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();
            setLogs(data.logs);
            setTotalCount(data.totalCount);
            setLoading(false);
        } catch (err) {
            console.error('Error fetching logs:', err);
            setError('Failed to fetch logs');
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs(currentPage);
    }, [currentPage]);

    const handlePageChange = (page) => {
        setCurrentPage(page);
    };

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
    <Layout>
        <div>
        <header className="header-menu">
        <div>
          <Menu />
        </div>
      </header>
            <h2>User Logs</h2>
            <div style={{width:'63%',marginLeft:"auto",marginRight:"auto"}}>
            <table border="1" style={{maxWidth:'100%',borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Action</th>
                        <th>IP Address</th>
                        <th>Status</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
                    {logs.map((log) => (
                        <tr key={log.log_id}>
                            <td>{log.user_id?.name || 'N/A'}</td>
                            <td>{log.action}</td>
                            <td>{log.ip_address}</td>
                            <td>{log.status}</td>
                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            
            {logs.length ? (
                <Pagination
                    itemsPerPage={itemsPerPage}
                    totalItems={totalCount}
                    paginate={handlePageChange}
                    currentPage={currentPage}
                />
            ) : null}
            </div>
        </div>
        </Layout>
    );
};

export default LogsPage;

