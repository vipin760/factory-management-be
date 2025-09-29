const { pool } = require('../../config/database');

async function createTablesIfNotExist() {
  console.log("<><>start checking tables")
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        contact_email TEXT,
        phone TEXT,
        gstin TEXT,
        address JSONB,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS raw_materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        uom TEXT NOT NULL,
        category TEXT,
        batchable BOOLEAN DEFAULT true,
        reorder_level NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS raw_material_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_material_id UUID REFERENCES raw_materials(id) ON DELETE CASCADE NOT NULL,
        batch_no TEXT NOT NULL,
        qty_received NUMERIC NOT NULL DEFAULT 0,
        qty_available NUMERIC NOT NULL DEFAULT 0,
        cost_per_unit NUMERIC NOT NULL DEFAULT 0,
        mfg_date DATE,
        exp_date DATE,
        location TEXT,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS indents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        indent_no TEXT UNIQUE NOT NULL,
        requested_by UUID REFERENCES users(id) NOT NULL,
        status TEXT DEFAULT 'draft' NOT NULL,
        required_by DATE,
        priority TEXT DEFAULT 'medium' NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS indent_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      indent_id UUID REFERENCES indents(id) ON DELETE CASCADE NOT NULL,
      raw_material_id UUID REFERENCES raw_materials(id) NOT NULL,
      qty NUMERIC NOT NULL,
      uom TEXT NOT NULL,
      notes TEXT
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_no TEXT UNIQUE NOT NULL,
        vendor_id UUID REFERENCES vendors(id) NOT NULL,
        created_by UUID REFERENCES users(id) NOT NULL,
        status TEXT DEFAULT 'draft' NOT NULL, -- draft, submitted, approved, partially_received, closed
        total_value NUMERIC DEFAULT 0,
        expected_delivery DATE,
        created_at TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
        raw_material_id UUID REFERENCES raw_materials(id) NOT NULL,
        qty NUMERIC NOT NULL,
        uom TEXT NOT NULL,
        rate NUMERIC,
        received_qty NUMERIC DEFAULT 0
      );

       CREATE TABLE IF NOT EXISTS vendors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        contact_email TEXT,
        phone TEXT,
        gstin TEXT,
        address JSONB,
        created_at TIMESTAMP DEFAULT now()
      );
      
       CREATE TABLE IF NOT EXISTS grns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        grn_no TEXT UNIQUE NOT NULL,
        purchase_order_id UUID REFERENCES purchase_orders(id) NOT NULL,
        received_by UUID REFERENCES users(id) NOT NULL,
        received_at TIMESTAMP DEFAULT now(),
        notes TEXT
      );

      -- Add remaining tables here following same pattern...
    `);


    console.log('✅ Tables checked/created successfully.');
  } catch (err) {
    console.error('❌ Failed to create tables:', err);
    throw err;
  }
}

module.exports = { createTablesIfNotExist };
