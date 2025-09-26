const { Pool } = require('pg');
require("dotenv").config();

// Create the psSQL pool
const pool = new Pool({
  host: process.env.DB_HOST,      // e.g., 127.0.0.1
  port: process.env.DB_PORT,      // e.g., 5432
  user: process.env.DB_USER,      // e.g., postgres
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

module.exports = { pool };
