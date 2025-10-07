const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction")
const { validate: isUuid } = require('uuid');

exports.createProductionService = async (body, userId) => {
  const client = await pool.connect();
  let started = false;
  try {
    const {
      batch_no,
      product_id,
      article_sku,
      planned_qty,
      start_date,
      end_date,
      produced_qty,
      status,
      batch_consumptions,   // [{ raw_material_id, qty_consumed, rate }]
      operation_expenses    // [{ expense_category, description, qty, rate }]
    } = body;

    // -------------------- VALIDATION --------------------
    if (!batch_no) return { status: false, message: "Batch number is required." };
    if (!isUuid(batch_no)) {
      return { status: false, message: "Please enter a valid batch number" };
    }
    if (!product_id) return { status: false, message: "Product ID is required." };
    if (!planned_qty || planned_qty <= 0)
      return { status: false, message: "Planned quantity must be greater than 0." };

    if (!Array.isArray(batch_consumptions) || batch_consumptions.length === 0)
      return { status: false, message: "At least one raw material consumption is required." };

    if (!Array.isArray(operation_expenses))
      return { status: false, message: "Operation expenses must be an array (can be empty)." };

    // Begin transaction
    await client.query("BEGIN");
    started = true;

    // Check if batch exists
    const batchExist = await client.query(`SELECT batch_no FROM batches WHERE id=$1`, [batch_no]);
    if (batchExist.rows.length === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Could not find this batch number" };
    }

    // Check for duplicate batch_no
    const existingBatch = await client.query(
      `SELECT id FROM production_batches WHERE batch_id = $1`,
      [batch_no]
    );
    if (existingBatch.rows.length > 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Batch number already exists." };
    }

    // Check if product exists
    const productExist = await client.query(`SELECT product_name FROM products WHERE id=$1`, [product_id]);
    if (productExist.rows.length === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Product not found. Please check the Product ID." };
    }

    // Step 1: Insert production batch
    const insertBatchQuery = `
      INSERT INTO production_batches (
        batch_id, product_id, article_sku, planned_qty, produced_qty
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [
      batch_no,
      product_id,
      article_sku || null,
      planned_qty,
      produced_qty || 0
    ];
    const batchResult = await client.query(insertBatchQuery, values);
    const newBatch = batchResult.rows[0];

    // Step 2: Handle raw material consumptions
    const insertedConsumptions = [];
    for (const { raw_material_id, qty_consumed, rate } of batch_consumptions) {
      if (!raw_material_id) return { status:false, message:"Raw material ID is required in consumption."}
      if (!qty_consumed || qty_consumed <= 0)
        return { status:false, message:"Quantity consumed must be greater than 0."}
      if (rate == null || rate < 0)
        return { status:false,message:"Rate must be a non-negative number."}

      // Lock row for stock consistency
      const stockCheck = await client.query(
        `SELECT total_qty,name FROM raw_materials WHERE id = $1 FOR UPDATE`,
        [raw_material_id]
      );

      if (stockCheck.rows.length === 0)
        return { status:false,message:`Raw material not found: ${raw_material_id}`}

      const available = Number(stockCheck.rows[0].total_qty);
      if (available < qty_consumed) {
        return { status:false,message:`Insufficient stock for raw material '${stockCheck.rows[0].name}'. Available: ${available}, Required: ${qty_consumed}`}
      }

      // Update stock
      const newQty = available - qty_consumed;
      await client.query(
        `UPDATE raw_materials SET total_qty = $1 WHERE id = $2`,
        [newQty, raw_material_id]
      );

      // Insert consumption record
      const insertConsumption = await client.query(
        `INSERT INTO batch_raw_material_consumptions (
          production_batch_id, raw_material_id, qty_consumed, rate
        ) VALUES ($1, $2, $3, $4)
        RETURNING *;`,
        [newBatch.id, raw_material_id, qty_consumed, rate]
      );
      insertedConsumptions.push(insertConsumption.rows[0]);
    }

    // Step 3: Insert operation expenses
    const insertedExpenses = [];
    for (const expense of operation_expenses) {
      const { expense_category, description, qty, rate } = expense;

      if (!expense_category) return { status:false,message:`Expense category is required.`}
      if (qty == null || qty < 0) return { status:false, message:`Expense quantity must be a non-negative number.`}
      if (rate == null || rate < 0) return { status:false,message:`Expense rate must be a non-negative number.`}

      const insertExpense = await client.query(
        `INSERT INTO batch_expenses (
          production_batch_id, expense_category, description, qty, rate
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *;`,
        [newBatch.id, expense_category, description || null, qty, rate]
      );
      insertedExpenses.push(insertExpense.rows[0]);
    }

    // Commit transaction
    await client.query("COMMIT");

    return {
      status: true,
      message: "Production batch created successfully.",
      data: {
        ...newBatch,
        batch_raw_material_consumptions: insertedConsumptions,
        batch_expenses: insertedExpenses
      }
    };
  } catch (error) {
    if (started) await client.query("ROLLBACK");
    return {
      status: false,
      message: `Failed to create production batch. (${error.message})`
    };
  } finally {
    client.release();
  }
};

exports.getAllProductionService = async (query) => {
  try {
    const {
      search,
      status,
      start_date,
      end_date,
      page = 1,
      limit = 10,
      sort_by = "created_at",
      order = "desc"
    } = query;

    const isFetchAll = limit === "all";
    const offset = isFetchAll ? 0 : (page - 1) * limit;

    let values = [];
    let idx = 1;

    // Base query with joins for raw material consumptions and batch expenses
    let baseQuery = `
      SELECT 
        pb.*,
        b.batch_no,
        b.status AS batch_status,
        b.start_date AS batch_start_date,
        b.end_date AS batch_end_date,
        p.product_name,
        COALESCE(
          SUM(brmc.qty_consumed * brmc.rate), 0
        ) + COALESCE(
          SUM(be.qty * be.rate), 0
        ) AS total_batch_cost,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', brmc.id,
              'raw_material_id', brmc.raw_material_id,
              'qty_consumed', brmc.qty_consumed,
              'rate', brmc.rate,
              'total_cost', (brmc.qty_consumed * brmc.rate),
              'raw_material_name', rm.name
            )
          ) FILTER (WHERE brmc.id IS NOT NULL),
          '[]'
        ) AS batch_consumptions,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', be.id,
              'expense_category', be.expense_category,
              'description', be.description,
              'qty', be.qty,
              'rate', be.rate,
              'total_cost', (be.qty * be.rate)
            )
          ) FILTER (WHERE be.id IS NOT NULL),
          '[]'
        ) AS batch_expenses
      FROM production_batches pb
      LEFT JOIN batches b ON pb.batch_id = b.id
      LEFT JOIN products p ON pb.product_id = p.id
      LEFT JOIN batch_raw_material_consumptions brmc ON brmc.production_batch_id = pb.id
      LEFT JOIN raw_materials rm ON brmc.raw_material_id = rm.id
      LEFT JOIN batch_expenses be ON be.production_batch_id = pb.id
      WHERE 1=1
    `;

    // Search filter
    if (search) {
      baseQuery += ` AND (b.batch_no ILIKE $${idx} OR pb.article_sku ILIKE $${idx} OR p.product_name ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    // Status filter (from batches)
    if (status) {
      baseQuery += ` AND b.status = $${idx}`;
      values.push(status);
      idx++;
    }

    // Date filters
    if (start_date) {
      baseQuery += ` AND b.start_date >= $${idx}`;
      values.push(start_date);
      idx++;
    }
    if (end_date) {
      baseQuery += ` AND b.end_date <= $${idx}`;
      values.push(end_date);
      idx++;
    }

    // Group by production batch to aggregate consumptions & expenses
    baseQuery += `
      GROUP BY pb.id, b.batch_no, b.status, b.start_date, b.end_date, p.product_name
      ORDER BY ${sort_by} ${order.toUpperCase() === "ASC" ? "ASC" : "DESC"}
    `;

    // Add limit/offset if not fetching all
    if (!isFetchAll) {
      baseQuery += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      values.push(limit, offset);
    }

    const result = await sqlQueryFun(baseQuery, values);

    // Count total rows for pagination
    let countQuery = `SELECT COUNT(*) AS total FROM production_batches pb LEFT JOIN batches b ON pb.batch_id = b.id WHERE 1=1`;
    let countValues = [];
    let countIdx = 1;

    if (search) {
      countQuery += ` AND (b.batch_no ILIKE $${countIdx} OR pb.article_sku ILIKE $${countIdx} OR p.product_name ILIKE $${countIdx})`;
      countValues.push(`%${search}%`);
      countIdx++;
    }
    if (status) {
      countQuery += ` AND b.status = $${countIdx}`;
      countValues.push(status);
      countIdx++;
    }
    if (start_date) {
      countQuery += ` AND b.start_date >= $${countIdx}`;
      countValues.push(start_date);
      countIdx++;
    }
    if (end_date) {
      countQuery += ` AND b.end_date <= $${countIdx}`;
      countValues.push(end_date);
      countIdx++;
    }

    const countResult = await sqlQueryFun(countQuery, countValues);
    const total = parseInt(countResult[0]?.total || 0);

    return {
      status: true,
      data: {
        result,
        total,
        page: isFetchAll ? 1 : parseInt(page),
        limit: isFetchAll ? total : parseInt(limit)
      },
      message: "Production batches fetched successfully."
    };
  } catch (error) {
    return {
      status: false,
      data: "",
      message: `Something went wrong. (${error.message})`
    };
  }
};

exports.productionBatchNamesOnly = async () => {
  try {
    const query = `
      SELECT DISTINCT batch_no
      FROM raw_material_batches
      ORDER BY batch_no ASC;
    `;

    const result = await sqlQueryFun(query, []);

    // Return just an array of batch numbers
    const batchNumbers = result.map(r => r.batch_no);

    return {
      status: true,
      data: batchNumbers,
      message: "Unique batch numbers fetched successfully."
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`
    };
  }
};

exports.updateProductionService = async ( production_batch_id,body) => {
  const client = await pool.connect();
  let started = false;

  try {
    const {
      batch_no,
      product_id,
      article_sku,
      planned_qty,
      produced_qty,
      batch_consumptions = [],
      operation_expenses = []
    } = body;

    // -------- Basic Validation --------
    if (!production_batch_id)
      return { status: false, message: "Production batch ID is required." };
    if (!isUuid(production_batch_id))
      return { status: false, message: "Invalid production batch ID." };
    if (!batch_no)
      return { status: false, message: "Batch number is required." };
    if (!product_id)
      return { status: false, message: "Product ID is required." };
    if (!planned_qty || planned_qty <= 0)
      return { status: false, message: "Planned quantity must be greater than 0." };

    await client.query("BEGIN");
    started = true;

    // -------- Check if production batch exists --------
    const existingBatch = await client.query(
      `SELECT id FROM production_batches WHERE id = $1`,
      [production_batch_id]
    );
    if (existingBatch.rows.length === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Production batch not found." };
    }

    // -------- Step 1: Revert previous raw material stock --------
    const prevConsumptions = await client.query(
      `SELECT raw_material_id, qty_consumed FROM batch_raw_material_consumptions WHERE production_batch_id = $1`,
      [production_batch_id]
    );

    for (const prev of prevConsumptions.rows) {
      await client.query(
        `UPDATE raw_materials SET total_qty = total_qty + $1 WHERE id = $2`,
        [prev.qty_consumed, prev.raw_material_id]
      );
    }

    // -------- Step 2: Delete old records (consumptions & expenses) --------
    await client.query(
      `DELETE FROM batch_raw_material_consumptions WHERE production_batch_id = $1`,
      [production_batch_id]
    );
    await client.query(
      `DELETE FROM batch_expenses WHERE production_batch_id = $1`,
      [production_batch_id]
    );

    // -------- Step 3: Update main production batch --------
    console.log("<><>batch_no",batch_no)
    const updatedBatchRes = await client.query(
      `UPDATE production_batches
       SET batch_id = $1, product_id = $2, article_sku = $3, planned_qty = $4, produced_qty = $5
       WHERE id = $6
       RETURNING *`,
      [batch_no, product_id, article_sku || null, planned_qty, produced_qty || 0, production_batch_id]
    );

    const updatedBatch = updatedBatchRes.rows[0];

    // -------- Step 4: Insert new consumptions --------
    const insertedConsumptions = [];
    for (const { raw_material_id, qty_consumed, rate } of batch_consumptions) {
      if (!raw_material_id || qty_consumed <= 0)
        throw new Error("Invalid raw material consumption data.");

      const stockCheck = await client.query(
        `SELECT total_qty, name FROM raw_materials WHERE id = $1 FOR UPDATE`,
        [raw_material_id]
      );
      if (stockCheck.rows.length === 0)
        throw new Error(`Raw material not found (${raw_material_id}).`);

      const available = Number(stockCheck.rows[0].total_qty);
      if (available < qty_consumed)
        throw new Error(
          `Insufficient stock for '${stockCheck.rows[0].name}'. Available: ${available}, Required: ${qty_consumed}`
        );

      await client.query(
        `UPDATE raw_materials SET total_qty = $1 WHERE id = $2`,
        [available - qty_consumed, raw_material_id]
      );

      const inserted = await client.query(
        `INSERT INTO batch_raw_material_consumptions
         (production_batch_id, raw_material_id, qty_consumed, rate)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [production_batch_id, raw_material_id, qty_consumed, rate]
      );
      insertedConsumptions.push(inserted.rows[0]);
    }

    // -------- Step 5: Insert updated operation expenses --------
    const insertedExpenses = [];
    for (const { expense_category, description, qty, rate } of operation_expenses) {
      if (!expense_category)
        throw new Error("Expense category is required.");
      if (qty < 0 || rate < 0)
        throw new Error("Expense quantity and rate must be non-negative.");

      const inserted = await client.query(
        `INSERT INTO batch_expenses
         (production_batch_id, expense_category, description, qty, rate)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [production_batch_id, expense_category, description || null, qty, rate]
      );
      insertedExpenses.push(inserted.rows[0]);
    }

    // -------- Step 6: Commit transaction --------
    await client.query("COMMIT");

    return {
      status: true,
      message: "Production batch updated successfully.",
      data: {
        ...updatedBatch,
        batch_raw_material_consumptions: insertedConsumptions,
        batch_expenses: insertedExpenses
      }
    };
  } catch (error) {
    console.log("<><>error", error)
    if (started) await client.query("ROLLBACK");
    return {
      status: false,
      message: `Failed to update production batch. (${error.message})`
    };
  } finally {
    client.release();
  }
};

exports.deleteProductionService = async (productionBatchId) => {
  const client = await pool.connect();

  try {
    if (!isUuid(productionBatchId)) {
      return { status: false, message: "Invalid production batch ID." };
    }

    await client.query("BEGIN");

    // 1️⃣ Check if production batch exists
    const batchExist = await sqlQueryFun(
      `SELECT id FROM production_batches WHERE id = $1`,
      [productionBatchId],
      client
    );
    if (batchExist.length === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Production batch not found." };
    }

    // 2️⃣ Fetch all consumptions for this batch
    const consumptions = await sqlQueryFun(
      `SELECT raw_material_id, qty_consumed 
       FROM batch_raw_material_consumptions 
       WHERE production_batch_id = $1`,
      [productionBatchId],
      client
    );

    // 3️⃣ Restore consumed quantities back to raw_materials
    for (const item of consumptions) {
      await sqlQueryFun(
        `UPDATE raw_materials 
         SET total_qty = total_qty + $1
         WHERE id = $2`,
        [item.qty_consumed, item.raw_material_id],
        client
      );
    }

    // 4️⃣ Delete from child tables
    await sqlQueryFun(
      `DELETE FROM batch_raw_material_consumptions WHERE production_batch_id = $1`,
      [productionBatchId],
      client
    );

    await sqlQueryFun(
      `DELETE FROM batch_expenses WHERE production_batch_id = $1`,
      [productionBatchId],
      client
    );

    // 5️⃣ Delete main production batch
    await sqlQueryFun(
      `DELETE FROM production_batches WHERE id = $1`,
      [productionBatchId],
      client
    );

    await client.query("COMMIT");

    return {
      status: true,
      message: "Production batch and related data deleted successfully.",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      status: false,
      message: `Failed to delete production batch. (${error.message})`,
    };
  } finally {
    client.release();
  }
};
