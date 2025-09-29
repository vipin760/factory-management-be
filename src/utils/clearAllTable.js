const { pool } = require('../config/database');

async function clearAllTables() {
  try {
    // Disable foreign key constraints temporarily
    await pool.query('SET session_replication_role = replica;');

    // Truncate tables in order (child tables first)
    await pool.query(`
      TRUNCATE TABLE 
        indent_items,
        purchase_order_items,
        raw_material_batches,
        indents,
        purchase_orders,
        raw_materials,
        vendors,
        users
      RESTART IDENTITY CASCADE;
    `);

    // Re-enable foreign key constraints
    await pool.query('SET session_replication_role = DEFAULT;');

    console.log('✅ All tables cleared successfully.');
  } catch (err) {
    console.error('❌ Failed to clear tables:', err);
    throw err;
  }
}

module.exports = { clearAllTables };
