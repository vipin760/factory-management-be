const { pool } = require('../config/database');

async function clearAllTables() {
  try {
    // Disable foreign key constraints temporarily
    await pool.query('SET session_replication_role = replica;');

    // Truncate tables in order (child tables first)
    const data = await pool.query(`
  TRUNCATE TABLE 
  batch_consumptions,
  batch_raw_material_consumptions,
    grn_items,
    grns,
    purchase_order_items,
    purchase_orders,
    indents,
    raw_material_batches,
    raw_materials,
    vendors,
    production_batches,
    audit_logs,
    operation_expenses,
    batches,
    products,
    ordered_item_history,
    batch_expenses
  RESTART IDENTITY CASCADE;
`);
//  users,
    // Re-enable foreign key constraints
    await pool.query('SET session_replication_role = DEFAULT;');

    console.log('✅ All tables cleared successfully.');
    return { status:true,message:"All tables cleared successfully"}
  } catch (err) {
    console.error('❌ Failed to clear tables:', err);
    return { status:false,message:`${err.message}`}
  }
}

async function dropAllTables() {
  try {
    // Disable foreign key constraints temporarily
    await pool.query('SET session_replication_role = replica;');

    // Drop tables in order (child tables first)
    const tables = [
      'batch_consumptions',
      'batch_raw_material_consumptions',
      'grn_items',
      'grns',
      'purchase_order_items',
      'purchase_orders',
      'indents',
      'raw_material_batches',
      'raw_materials',
      'vendors',
      'production_batches',
      'audit_logs',
      'operation_expenses',
      'batches',
      'products',
      'ordered_item_history',
      'batch_expenses'

    ];
//  'users',
    for (const table of tables) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
    }

    // Re-enable foreign key constraints
    await pool.query('SET session_replication_role = DEFAULT;');

    console.log('✅ All tables dropped successfully.');
    return { status: true ,message:"All tables dropped successfully"};
  } catch (err) {
    console.error('❌ Failed to drop tables:', err);
    return { status: false, message: err.message };
  }
}
module.exports = { clearAllTables,dropAllTables };
