const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createProductionService1 = async (body, userId) => {
  try {
    const { 
      batch_no, 
      article_sku, 
      planned_qty, 
      start_date, 
      end_date, 
      status, 
      batch_consumptions, 
      operation_expenses // array of expenses
    } = body;

    // Step 1: Insert into production_batches
    const insertBatchQuery = `
      INSERT INTO production_batches (
        batch_no, article_sku, planned_qty, start_date, end_date, status
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'planned'))
      RETURNING *;
    `;
    const batchValues = [batch_no, article_sku, planned_qty, start_date || null, end_date || null, status];
    const batchResult = await sqlQueryFun(insertBatchQuery, batchValues);
    const newBatch = batchResult[0];

    // Step 2: Insert batch_consumptions
    let insertedConsumptions = [];
    if (Array.isArray(batch_consumptions) && batch_consumptions.length > 0) {
      for (const item of batch_consumptions) {
        const { raw_material_batch_id, qty_consumed, cost } = item;
        const insertConsumptionQuery = `
          INSERT INTO batch_consumptions (
            production_batch_id, raw_material_batch_id, qty_consumed, cost
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *;
        `;
        const values = [newBatch.id, raw_material_batch_id, qty_consumed, cost || null];
        const consumptionResult = await sqlQueryFun(insertConsumptionQuery, values);
        insertedConsumptions.push(consumptionResult[0]);
      }
    }

    // Step 3: Insert operation_expenses
    let insertedExpenses = [];
    if (Array.isArray(operation_expenses) && operation_expenses.length > 0) {
      for (const expense of operation_expenses) {
        const { expense_type, amount, expense_date, labour_type, labour_count, category, remarks } = expense;
        const insertExpenseQuery = `
          INSERT INTO operation_expenses (
            production_batch_id, expense_type, amount, expense_date, labour_type, labour_count, category, remarks
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `;
        const values = [
          newBatch.id,
          expense_type,
          amount,
          expense_date || null,
          labour_type || null,
          labour_count || null,
          category || null,
          remarks || null
        ];
        const expenseResult = await sqlQueryFun(insertExpenseQuery, values);
        insertedExpenses.push(expenseResult[0]);
      }
    }

    // Step 4: Return full response
    return {
      status: true,
      data: {
        ...newBatch,
        batch_consumptions: insertedConsumptions,
        operation_expenses: insertedExpenses
      },
      message: "Production batch created successfully with consumptions and operation expenses."
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    };
  }
};

exports.createProductionService = async (body, userId) => {
  const client = await pool.connect();
  try {
    const { 
      batch_no, 
      article_sku, 
      planned_qty, 
      start_date, 
      end_date, 
      status, 
      batch_consumptions, 
      operation_expenses 
    } = body;

    // ✅ Begin transaction
    await client.query("BEGIN");

    // Step 1: Insert into production_batches
    const insertBatchQuery = `
      INSERT INTO production_batches (
        batch_no, article_sku, planned_qty, start_date, end_date, status
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'planned'))
      RETURNING *;
    `;
    const batchValues = [batch_no, article_sku, planned_qty, start_date || null, end_date || null, status];
    const batchResult = await sqlQueryFun(insertBatchQuery, batchValues, client);
    const newBatch = batchResult[0];

    // Step 2: Insert batch_consumptions + decrease stock
    let insertedConsumptions = [];
    if (Array.isArray(batch_consumptions) && batch_consumptions.length > 0) {
      for (const item of batch_consumptions) {
        const { raw_material_batch_id, qty_consumed, cost } = item;
        const qtyToConsume = Number(qty_consumed);

        // Check stock availability
        const stockCheck = await sqlQueryFun(
          `SELECT qty_available FROM raw_material_batches WHERE id=$1 FOR UPDATE`,
          [raw_material_batch_id],
          client
        );

        if (stockCheck.length === 0) throw new Error(`Raw material batch not found: ${raw_material_batch_id}`);

        const available = Number(stockCheck[0].qty_available);
        if (available < qtyToConsume) {
          throw new Error(`Insufficient stock. Required: ${qtyToConsume}, Available: ${available}`);
        }

        // Deduct stock
        await sqlQueryFun(
          `UPDATE raw_material_batches
           SET qty_available = qty_available - $1
           WHERE id = $2`,
          [qtyToConsume, raw_material_batch_id],
          client
        );

        // Insert batch_consumptions record
        const insertConsumptionQuery = `
          INSERT INTO batch_consumptions (
            production_batch_id, raw_material_batch_id, qty_consumed, cost
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *;
        `;
        const consumptionResult = await sqlQueryFun(
          insertConsumptionQuery,
          [newBatch.id, raw_material_batch_id, qtyToConsume, cost || null],
          client
        );
        insertedConsumptions.push(consumptionResult[0]);
      }
    }

    // Step 3: Insert operation_expenses
    let insertedExpenses = [];
    if (Array.isArray(operation_expenses) && operation_expenses.length > 0) {
      for (const expense of operation_expenses) {
        const { expense_type, amount, expense_date, labour_type, labour_count, category, remarks } = expense;
        const insertExpenseQuery = `
          INSERT INTO operation_expenses (
            production_batch_id, expense_type, amount, expense_date, labour_type, labour_count, category, remarks
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `;
        const expenseResult = await sqlQueryFun(
          insertExpenseQuery,
          [
            newBatch.id,
            expense_type,
            amount,
            expense_date || null,
            labour_type || null,
            labour_count || null,
            category || null,
            remarks || null
          ],
          client
        );
        insertedExpenses.push(expenseResult[0]);
      }
    }

    // ✅ Commit transaction
    await client.query("COMMIT");

    return {
      status: true,
      data: {
        ...newBatch,
        batch_consumptions: insertedConsumptions,
        operation_expenses: insertedExpenses
      },
      message: "Production batch created successfully. Stock updated."
    };

  } catch (error) {
    // ❌ Rollback on error
    await client.query("ROLLBACK");
    return {
      status: false,
      message: `Failed to create production batch. (${error.message})`
    };
  } finally {
    client.release();
  }
};

exports.getAllProductionService1 = async (query) => {
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

    let baseQuery = `
      WITH batch_data AS (
        SELECT 
          pb.id AS batch_id,
          pb.batch_no,
          pb.article_sku,
          pb.planned_qty,
          pb.produced_qty,
          pb.status,
          pb.start_date,
          pb.end_date,
          pb.created_at,
          COALESCE(SUM(bc.qty_consumed * rmb.cost_per_unit), 0) AS material_cost,
          COALESCE(
            json_agg(
              json_build_object(
                'id', bc.id,
                'raw_material_batch_id', bc.raw_material_batch_id,
                'qty_consumed', bc.qty_consumed,
                'cost_per_unit', rmb.cost_per_unit,
                'total_cost', bc.qty_consumed * rmb.cost_per_unit,
                'raw_material', json_build_object(
                  'id', rmb.raw_material_id,
                  'batch_no', rmb.batch_no,
                  'name', rm.name
                )
              )
            ) FILTER (WHERE bc.id IS NOT NULL),
            '[]'
          ) AS batch_consumptions,
          COALESCE(
            json_agg(
              json_build_object(
                'id', oe.id,
                'expense_type', oe.expense_type,
                'amount', oe.amount,
                'expense_date', oe.expense_date,
                'labour_type', oe.labour_type,
                'labour_count', oe.labour_count,
                'category', oe.category,
                'remarks', oe.remarks
              )
            ) FILTER (WHERE oe.id IS NOT NULL),
            '[]'
          ) AS operation_expenses,
          COALESCE(SUM(oe.amount),0) AS total_operation_expense
        FROM production_batches pb
        LEFT JOIN batch_consumptions bc ON bc.production_batch_id = pb.id
        LEFT JOIN raw_material_batches rmb ON rmb.id = bc.raw_material_batch_id
        LEFT JOIN raw_materials rm ON rm.id = rmb.raw_material_id
        LEFT JOIN operation_expenses oe ON oe.production_batch_id = pb.id
        WHERE 1=1
    `;

    const values = [];
    let idx = 1;

    if (search) {
      baseQuery += ` AND (pb.batch_no ILIKE $${idx} OR pb.article_sku ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    if (status) {
      baseQuery += ` AND pb.status = $${idx}`;
      values.push(status);
      idx++;
    }

    if (start_date) {
      baseQuery += ` AND pb.start_date >= $${idx}`;
      values.push(start_date);
      idx++;
    }

    if (end_date) {
      baseQuery += ` AND pb.end_date <= $${idx}`;
      values.push(end_date);
      idx++;
    }

    baseQuery += `
        GROUP BY pb.id
      )
      SELECT *,
        (material_cost + total_operation_expense) AS total_product_expenditure,
        TO_CHAR(start_date, 'DD/MM/YYYY') AS start_date_formatted
      FROM batch_data
      ORDER BY ${sort_by} ${order.toUpperCase() === "ASC" ? "ASC" : "DESC"}
    `;

    if (!isFetchAll) {
      baseQuery += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      values.push(limit, offset);
    }

    const result = await sqlQueryFun(baseQuery, values);

    // Count query
    let countQuery = `SELECT COUNT(*) AS total FROM production_batches pb WHERE 1=1`;
    const countValues = [];
    let countIdx = 1;

    if (search) {
      countQuery += ` AND (pb.batch_no ILIKE $${countIdx} OR pb.article_sku ILIKE $${countIdx})`;
      countValues.push(`%${search}%`);
      countIdx++;
    }

    if (status) {
      countQuery += ` AND pb.status = $${countIdx}`;
      countValues.push(status);
      countIdx++;
    }

    if (start_date) {
      countQuery += ` AND pb.start_date >= $${countIdx}`;
      countValues.push(start_date);
      countIdx++;
    }

    if (end_date) {
      countQuery += ` AND pb.end_date <= $${countIdx}`;
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
      message: "Production batches with material & operation expenses fetched successfully."
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`
    };
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

    let baseQuery = `
      WITH batch_data AS (
        SELECT 
          pb.id AS batch_id,
          pb.batch_no,
          pb.article_sku,
          pb.planned_qty,
          pb.produced_qty,
          pb.status,
          pb.start_date,
          pb.end_date,
          pb.created_at,
          COALESCE(SUM(bc.qty_consumed * rmb.cost_per_unit), 0) AS material_cost,
          COALESCE(
            json_agg(
              json_build_object(
                'id', bc.id,
                'raw_material_batch_id', bc.raw_material_batch_id,
                'qty_consumed', bc.qty_consumed,
                'cost_per_unit', rmb.cost_per_unit,
                'total_cost', bc.qty_consumed * rmb.cost_per_unit,
                'raw_material', json_build_object(
                  'id', rmb.raw_material_id,
                  'batch_no', rmb.batch_no,
                  'name', rm.name
                )
              )
            ) FILTER (WHERE bc.id IS NOT NULL),
            '[]'
          ) AS batch_consumptions,
          COALESCE(
            json_agg(
              json_build_object(
                'id', oe.id,
                'expense_type', oe.expense_type,
                'amount', oe.amount,
                'expense_date', oe.expense_date,
                'labour_type', oe.labour_type,
                'labour_count', oe.labour_count,
                'category', oe.category,
                'remarks', oe.remarks
              )
            ) FILTER (WHERE oe.id IS NOT NULL),
            '[]'
          ) AS operation_expenses,
          COALESCE(SUM(oe.amount),0) AS total_operation_expense
        FROM production_batches pb
        LEFT JOIN batch_consumptions bc ON bc.production_batch_id = pb.id
        LEFT JOIN raw_material_batches rmb ON rmb.id = bc.raw_material_batch_id
        LEFT JOIN raw_materials rm ON rm.id = rmb.raw_material_id
        LEFT JOIN operation_expenses oe ON oe.production_batch_id = pb.id
        WHERE 1=1
    `;

    const values = [];
    let idx = 1;

    if (search) {
      baseQuery += ` AND (pb.batch_no ILIKE $${idx} OR pb.article_sku ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    if (status) {
      baseQuery += ` AND pb.status = $${idx}`;
      values.push(status);
      idx++;
    }

    if (start_date) {
      baseQuery += ` AND pb.start_date >= $${idx}`;
      values.push(start_date);
      idx++;
    }

    if (end_date) {
      baseQuery += ` AND pb.end_date <= $${idx}`;
      values.push(end_date);
      idx++;
    }

    baseQuery += `
        GROUP BY pb.id
      )
      SELECT *,
        material_cost / NULLIF(produced_qty,0) AS material_cost_per_product,
        ROUND(material_cost / NULLIF(produced_qty,0))::INT AS material_cost_per_product,
        TO_CHAR(start_date, 'DD/MM/YYYY') AS start_date_formatted
      FROM batch_data
      ORDER BY ${sort_by} ${order.toUpperCase() === "ASC" ? "ASC" : "DESC"}
    `;

    if (!isFetchAll) {
      baseQuery += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      values.push(limit, offset);
    }

    const result = await sqlQueryFun(baseQuery, values);

    // Count query
    let countQuery = `SELECT COUNT(*) AS total FROM production_batches pb WHERE 1=1`;
    const countValues = [];
    let countIdx = 1;

    if (search) {
      countQuery += ` AND (pb.batch_no ILIKE $${countIdx} OR pb.article_sku ILIKE $${countIdx})`;
      countValues.push(`%${search}%`);
      countIdx++;
    }

    if (status) {
      countQuery += ` AND pb.status = $${countIdx}`;
      countValues.push(status);
      countIdx++;
    }

    if (start_date) {
      countQuery += ` AND pb.start_date >= $${countIdx}`;
      countValues.push(start_date);
      countIdx++;
    }

    if (end_date) {
      countQuery += ` AND pb.end_date <= $${countIdx}`;
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
      message: "Production batches with material & operation expenses fetched successfully."
    };

  } catch (error) {
    return {
      status: false,
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

exports.updateProductionService = async (id, body) => {
  try {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(body)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (fields.length === 0) {
      return {
        status: false,
        message: "No fields provided to update."
      };
    }

    values.push(id); // last param is id

    const query = `
      UPDATE production_batches
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;

    const result = await sqlQueryFun(query, values);

    if (result.length === 0) {
      return { status: false, message: "Production batch not found." };
    }

    return {
      status: true,
      data: result[0],
      message: "Production updated successfully."
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};

exports.deleteProductionService = async (id) => {
  try {
   

    return { status: true, data: result[0], message: "GRN deleted successfully." };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};