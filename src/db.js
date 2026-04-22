'use strict';
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.IPCAVNF_DB_HOST || 'localhost',
  port:     parseInt(process.env.IPCAVNF_DB_PORT || '3306', 10),
  database: process.env.IPCAVNF_DB_NAME || 'ipcavnf',
  user:     process.env.IPCAVNF_DB_USER || '',
  password: process.env.IPCAVNF_DB_PASS || '',
  charset:  'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
