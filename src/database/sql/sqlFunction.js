const { pool } = require("../../config/database");

async function sqlQueryFun(query, params = []) {
  try {
    const res = await pool.query(query, params);
    return res.rows;
  } catch (err) {
    console.error('SQL Error:', err);
    throw err;
  }
}

module.exports = { sqlQueryFun };
