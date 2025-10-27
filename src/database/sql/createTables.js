const { pool } = require('../../config/database');

async function createTablesIfNotExist() {
  try {

    await pool.query(`
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now()
  );

  -- Vendors table
  CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_email TEXT,
    phone TEXT,
    gstin TEXT,
    address JSONB,
    created_at TIMESTAMP DEFAULT now()
  );

  -- Raw materials table
  CREATE TABLE IF NOT EXISTS raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    uom TEXT NOT NULL,
    category TEXT,
    batchable BOOLEAN DEFAULT true,
    reorder_level NUMERIC DEFAULT 0,
    total_qty NUMERIC DEFAULT 0,
    created_at TIMESTAMP DEFAULT now()
  );
  
  CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT UNIQUE NOT NULL,
  product_code TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT now()
);

  CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no TEXT UNIQUE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT DEFAULT 'planned',  -- planned, in_progress, completed, QC
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unit_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_name TEXT NOT NULL,
  department_name TEXT,
  purpose TEXT,
  shop_name TEXT,
  product_name TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
   updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unit_master_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_master_id UUID REFERENCES unit_master(id) ON DELETE CASCADE,
  raw_material_id UUID REFERENCES raw_materials(id),
  weight NUMERIC,
  unit TEXT,
  rate NUMERIC,
  value NUMERIC,
  created_at TIMESTAMP DEFAULT now(),
   updated_at TIMESTAMP DEFAULT now()
);

  -- Indents table
  CREATE TABLE IF NOT EXISTS indents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    indent_no TEXT UNIQUE NOT NULL,
    requested_by UUID REFERENCES users(id) NOT NULL,
    unit_master_id UUID REFERENCES unit_master(id) NOT NULL,
    quantity NUMERIC,
    status TEXT DEFAULT 'draft' NOT NULL,
    indent_date DATE,
    remarks TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
  );
-- Indents items table
  CREATE TABLE IF NOT EXISTS indent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id UUID REFERENCES indents(id) ON DELETE CASCADE,
  raw_material_id UUID REFERENCES raw_materials(id),
  article_name TEXT NOT NULL,
  weight NUMERIC,
  unit TEXT,
  rate NUMERIC,
  value NUMERIC,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for storing calculation section details
CREATE TABLE IF NOT EXISTS indent_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id UUID REFERENCES indents(id) ON DELETE CASCADE,
  total_value NUMERIC DEFAULT 0,
  profit_percentage NUMERIC DEFAULT 0,
  profit_amount NUMERIC DEFAULT 0,
  tax_percentage NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  round_off NUMERIC DEFAULT 0,
  final_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

  -- Purchase orders table
  CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id TEXT UNIQUE NOT NULL,  -- PO number        
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,         
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  order_date TIMESTAMP DEFAULT now(),                               
  expected_delivery DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'ordered','approved', 'processing', 'shipped', 'received', 'cancelled', 'returned')),
  total_amount NUMERIC DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,  
  raw_material_id UUID REFERENCES raw_materials(id) ON DELETE SET NULL NOT NULL,
  qty NUMERIC NOT NULL,
  rate NUMERIC DEFAULT 0,
  total_amount NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS ordered_item_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_orders_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,        
  old_status TEXT,
  new_status TEXT,
  old_qty NUMERIC,
  new_qty NUMERIC,
  old_rate NUMERIC,
  new_rate NUMERIC,
  remarks TEXT,
  changed_at TIMESTAMP DEFAULT now()
);

  -- GRNs table
  CREATE TABLE IF NOT EXISTS grns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_no TEXT UNIQUE NOT NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) NOT NULL,
    received_by UUID REFERENCES users(id) NOT NULL,
    received_at TIMESTAMP DEFAULT now(),
    gate_pass_number TEXT NOT NULL,
    notes TEXT
  );

   --  production section
  
  -- Production batches table
  CREATE TABLE IF NOT EXISTS production_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,  -- Which product
    article_sku TEXT,                                  -- Product SKU
    planned_qty NUMERIC NOT NULL,                      -- How much you plan to produce
    produced_qty NUMERIC DEFAULT 0,                    -- How much is produced (initially 0)
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_raw_material_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE NOT NULL,
    raw_material_id UUID REFERENCES raw_materials(id) NOT NULL,
    qty_consumed NUMERIC NOT NULL,
    rate NUMERIC NOT NULL,           -- Cost per unit
    total_cost NUMERIC GENERATED ALWAYS AS (qty_consumed * rate) STORED,
    created_at TIMESTAMP DEFAULT now()
);

  CREATE TABLE IF NOT EXISTS batch_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE NOT NULL,
    expense_category TEXT NOT NULL,    -- labour / machine / utility / gst / other
    description TEXT,                  -- Optional detail
    qty NUMERIC DEFAULT 1,             -- e.g., hours for labour, units for machine
    rate NUMERIC DEFAULT 0,            -- cost per qty
    total_cost NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
    created_at TIMESTAMP DEFAULT now()
);

  -- Audit logs table
 CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,              -- e.g., 'indent', 'batch', 'stock', 'order'
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,                   -- e.g., 'create', 'update', 'approve', 'complete'
    user_id UUID REFERENCES users(id),
    timestamp TIMESTAMP DEFAULT now(),
    details JSONB,                          -- store extra data like old/new values
    status TEXT,                            -- optional: for actions with states (e.g., pending, completed)
    metadata JSONB                          -- optional: store extra useful info for analytics
);

  -- Operation expenses table linked to production batches
 CREATE TABLE IF NOT EXISTS operation_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL,         
  amount NUMERIC NOT NULL,             
  expense_date DATE,
  labour_type TEXT,                  
  labour_count INT,                  
  category TEXT,                      
  remarks TEXT
  );

  CREATE TABLE IF NOT EXISTS raw_material_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_type TEXT CHECK (movement_type IN ('in','out')) NOT NULL,
    qty NUMERIC NOT NULL,
    cost_per_unit NUMERIC NOT NULL,
    reference_type TEXT NOT NULL,   
    reference_id UUID,             
    created_at TIMESTAMP DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS purchase_order_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    file_url TEXT NOT NULL,           -- URL/path to file (S3, server, etc.)
    file_type TEXT,                   -- MIME type or extension (e.g., image/png, pdf)
    remarks TEXT,                     -- Optional notes about the file
    verified_by UUID REFERENCES users(id), -- Admin who verifies
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

`);

    //     await pool.query(`
    //   CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    //   -- Users table
    //   CREATE TABLE IF NOT EXISTS users (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     name TEXT NOT NULL,
    //     email TEXT UNIQUE NOT NULL,
    //     password_hash TEXT NOT NULL,
    //     role TEXT NOT NULL,
    //     created_at TIMESTAMP DEFAULT now()
    //   );

    //   -- Vendors table
    //   CREATE TABLE IF NOT EXISTS vendors (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     name TEXT NOT NULL,
    //     contact_email TEXT,
    //     phone TEXT,
    //     gstin TEXT,
    //     address JSONB,
    //     created_at TIMESTAMP DEFAULT now()
    //   );

    //   -- Raw materials table
    //   CREATE TABLE IF NOT EXISTS raw_materials (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     code TEXT UNIQUE NOT NULL,
    //     name TEXT NOT NULL,
    //     description TEXT,
    //     uom TEXT NOT NULL,
    //     category TEXT,
    //     batchable BOOLEAN DEFAULT true,
    //     reorder_level NUMERIC DEFAULT 0,
    //     total_qty NUMERIC DEFAULT 0,
    //     created_at TIMESTAMP DEFAULT now()
    //   );

    //   CREATE TABLE IF NOT EXISTS products (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   product_name TEXT UNIQUE NOT NULL,
    //   product_code TEXT,
    //   description TEXT,
    //   created_at TIMESTAMP DEFAULT now()
    // );

    //   CREATE TABLE IF NOT EXISTS batches (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   batch_no TEXT UNIQUE NOT NULL,
    //   product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    //   created_by UUID REFERENCES users(id),
    //   start_date DATE DEFAULT CURRENT_DATE,
    //   end_date DATE,
    //   status TEXT DEFAULT 'planned',  -- planned, in_progress, completed, QC
    //   notes TEXT,
    //   created_at TIMESTAMP DEFAULT now()
    // );

    //   -- Indents table
    //   CREATE TABLE IF NOT EXISTS indents (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     indent_no TEXT UNIQUE NOT NULL,
    //     requested_by UUID REFERENCES users(id) NOT NULL,
    //     status TEXT DEFAULT 'draft' NOT NULL,
    //     batch_no UUID REFERENCES batches(id),
    //     required_by DATE,
    //     priority TEXT DEFAULT 'medium' NOT NULL,
    //     notes TEXT,
    //     approved_by UUID REFERENCES users(id),
    //     approved_at TIMESTAMP,
    //     created_at TIMESTAMP DEFAULT now(),
    //     updated_at TIMESTAMP DEFAULT now()
    //   );

    //   -- Purchase orders table
    //   CREATE TABLE IF NOT EXISTS purchase_orders (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   purchase_order_id TEXT UNIQUE NOT NULL,  -- PO number
    //   indent_id UUID REFERENCES indents(id) ON DELETE SET NULL,         
    //   vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,         
    //   created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    //   order_date TIMESTAMP DEFAULT now(),                               
    //   expected_delivery DATE,
    //   status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'ordered','approved', 'processing', 'shipped', 'received', 'cancelled', 'returned')),
    //   total_amount NUMERIC DEFAULT 0,
    //   remarks TEXT,
    //   created_at TIMESTAMP DEFAULT now(),
    //   updated_at TIMESTAMP DEFAULT now()
    // );

    // CREATE TABLE IF NOT EXISTS purchase_order_items (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,  
    //   raw_material_id UUID REFERENCES raw_materials(id) ON DELETE SET NULL NOT NULL,
    //   qty NUMERIC NOT NULL,
    //   rate NUMERIC DEFAULT 0,
    //   total_amount NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
    //   remarks TEXT
    // );

    // CREATE TABLE IF NOT EXISTS ordered_item_history (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   purchase_orders_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    //   changed_by UUID REFERENCES users(id) ON DELETE SET NULL,        
    //   old_status TEXT,
    //   new_status TEXT,
    //   old_qty NUMERIC,
    //   new_qty NUMERIC,
    //   old_rate NUMERIC,
    //   new_rate NUMERIC,
    //   remarks TEXT,
    //   changed_at TIMESTAMP DEFAULT now()
    // );

    //   -- GRNs table
    //   CREATE TABLE IF NOT EXISTS grns (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     grn_no TEXT UNIQUE NOT NULL,
    //     purchase_order_id UUID REFERENCES purchase_orders(id) NOT NULL,
    //     received_by UUID REFERENCES users(id) NOT NULL,
    //     received_at TIMESTAMP DEFAULT now(),
    //     gate_pass_number TEXT NOT NULL,
    //     notes TEXT
    //   );

    //    --  production section

    //   -- Production batches table
    //   CREATE TABLE IF NOT EXISTS production_batches (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     batch_id UUID REFERENCES batches(id) ON DELETE CASCADE NOT NULL,
    //     product_id UUID REFERENCES products(id) NOT NULL,  -- Which product
    //     article_sku TEXT,                                  -- Product SKU
    //     planned_qty NUMERIC NOT NULL,                      -- How much you plan to produce
    //     produced_qty NUMERIC DEFAULT 0,                    -- How much is produced (initially 0)
    //     created_at TIMESTAMP DEFAULT now()
    // );

    // CREATE TABLE IF NOT EXISTS batch_raw_material_consumptions (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE NOT NULL,
    //     raw_material_id UUID REFERENCES raw_materials(id) NOT NULL,
    //     qty_consumed NUMERIC NOT NULL,
    //     rate NUMERIC NOT NULL,           -- Cost per unit
    //     total_cost NUMERIC GENERATED ALWAYS AS (qty_consumed * rate) STORED,
    //     created_at TIMESTAMP DEFAULT now()
    // );

    //   CREATE TABLE IF NOT EXISTS batch_expenses (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE NOT NULL,
    //     expense_category TEXT NOT NULL,    -- labour / machine / utility / gst / other
    //     description TEXT,                  -- Optional detail
    //     qty NUMERIC DEFAULT 1,             -- e.g., hours for labour, units for machine
    //     rate NUMERIC DEFAULT 0,            -- cost per qty
    //     total_cost NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
    //     created_at TIMESTAMP DEFAULT now()
    // );

    //   -- Audit logs table
    //  CREATE TABLE IF NOT EXISTS audit_logs (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     entity_type TEXT NOT NULL,              -- e.g., 'indent', 'batch', 'stock', 'order'
    //     entity_id UUID NOT NULL,
    //     action TEXT NOT NULL,                   -- e.g., 'create', 'update', 'approve', 'complete'
    //     user_id UUID REFERENCES users(id),
    //     timestamp TIMESTAMP DEFAULT now(),
    //     details JSONB,                          -- store extra data like old/new values
    //     status TEXT,                            -- optional: for actions with states (e.g., pending, completed)
    //     metadata JSONB                          -- optional: store extra useful info for analytics
    // );

    //   -- Operation expenses table linked to production batches
    //  CREATE TABLE IF NOT EXISTS operation_expenses (
    //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //   production_batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    //   expense_type TEXT NOT NULL,         
    //   amount NUMERIC NOT NULL,             
    //   expense_date DATE,
    //   labour_type TEXT,                  
    //   labour_count INT,                  
    //   category TEXT,                      
    //   remarks TEXT
    //   );

    //   CREATE TABLE IF NOT EXISTS raw_material_movements (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     movement_type TEXT CHECK (movement_type IN ('in','out')) NOT NULL,
    //     qty NUMERIC NOT NULL,
    //     cost_per_unit NUMERIC NOT NULL,
    //     reference_type TEXT NOT NULL,   
    //     reference_id UUID,             
    //     created_at TIMESTAMP DEFAULT now()
    //   );

    //   CREATE TABLE IF NOT EXISTS purchase_order_files (
    //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    //     purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    //     uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    //     file_url TEXT NOT NULL,           -- URL/path to file (S3, server, etc.)
    //     file_type TEXT,                   -- MIME type or extension (e.g., image/png, pdf)
    //     remarks TEXT,                     -- Optional notes about the file
    //     verified_by UUID REFERENCES users(id), -- Admin who verifies
    //     verified_at TIMESTAMP,
    //     created_at TIMESTAMP DEFAULT now(),
    //     updated_at TIMESTAMP DEFAULT now()
    // );

    // `);
    console.log('✅ Tables checked/created successfully.');
  } catch (err) {
    console.error('❌ Failed to create tables:', err);
    throw err;
  }
}

module.exports = { createTablesIfNotExist };
