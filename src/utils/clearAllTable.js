const { pool } = require('../config/database');

async function clearAllTables() {
  try {
    // Disable foreign key constraints temporarily
    await pool.query('SET session_replication_role = replica;');

    // Truncate tables in order (child tables first)
    await pool.query(`
  TRUNCATE TABLE 
    batch_consumptions,
    grn_items,
    grns,
    purchase_order_items,
    purchase_orders,
    indent_items,
    indents,
    raw_material_batches,
    raw_materials,
    vendors,
    production_batches,
    audit_logs,
    users,
    operation_expenses
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
