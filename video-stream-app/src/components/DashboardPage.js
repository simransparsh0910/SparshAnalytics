// components/DashboardPage.js
import React from 'react';
import Layout from './Layout';
import Dashboard from './Dashboard';

const DashboardPage = (props) => {
  return (
    <Layout>
      <Dashboard {...props} />
    </Layout>
  );
};

export default DashboardPage;

