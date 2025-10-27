const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction")
const { validate: isUuid } = require('uuid');

exports.createIndentService1 = async (body, userId) => {
  const client = await pool.connect();
  try {
    const { indent_no, status, batch_no, required_by, priority, notes } = body;

    if (!indent_no) return { status: false, message: "Indent number is required." };
    if (!batch_no) return { status: false, message: "batch_no number is required." };
    if (!userId) return { status: false, message: "Requested_by (userId) is required." };

    if (!isUuid(batch_no)) {
      return { status: false, message: `Invalid batch ID: '${batch_no}'. Must be a valid UUID.` };
    }

    // Start transaction
    await client.query('BEGIN');

    const indentExist = await sqlQueryFun(`SELECT 1 FROM indents WHERE indent_no=$1`, [indent_no]);
    if (indentExist.length) {
      await client.query('ROLLBACK');
      return { status: false, message: `Indent number '${indent_no}' already exists.` };
    }

    const indentBatchCheck = await sqlQueryFun(`SELECT 
      i.id,i.indent_no,i.status,i.created_at,b.batch_no,p.product_name, p.product_code 
      FROM indents 
      i LEFT JOIN batches b ON i.batch_no = b.id 
      LEFT JOIN products p ON b.product_id = p.id 
      WHERE i.batch_no = $1`, [batch_no]);
    if (indentBatchCheck.length > 0) {
      await client.query('ROLLBACK');
      return { status: false, message: `An batch already used for this ${indentBatchCheck[0].batch_no} batch number` };
    }

    const batchCheck = await sqlQueryFun(`SELECT * FROM batches WHERE id = $1`, [batch_no])
    if (!batchCheck.length) return { status: false, message: "cannot find this batch number" }

    const validStatuses = ["draft", "submitted", "approved", "rejected"];
    const validPriorities = ["low", "medium", "high"];
    if (status && !validStatuses.includes(status)) {
      return { status: false, message: `Invalid status. Allowed values: ${validStatuses.join(", ")}.` };
    }
    if (priority && !validPriorities.includes(priority)) {
      return { status: false, message: `Invalid priority. Allowed values: ${validPriorities.join(", ")}.` };
    }
    let approved_by
    if (status === "submitted") {
      approved_by = userId
    }
    const insertIndentQry = `
      INSERT INTO indents (indent_no, requested_by, status,batch_no, required_by, priority, notes,approved_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const [newIndent] = await sqlQueryFun(insertIndentQry, [
      indent_no,
      userId,
      status || "draft",
      batch_no,
      required_by || null,
      priority || "medium",
      notes || null,
      approved_by || null
    ]);


    await client.query('COMMIT');
    return {
      status: true,
      data: { ...newIndent },
      message: "Indent has been created successfully.",
    };
  } catch (error) {
    console.log("<><>error w", error);
    await client.query('ROLLBACK');
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};

// exports.createIndentService = async (body, userId) => {
//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN");

//     const { indent_no, indent_date, status, items, calculation, remarks } = body;

//     // === Basic Validation ===
//     if (!indent_no) return { status: false, message: "Indent number is required." };
//     if (!indent_date) return { status: false, message: "Indent date is required." };
//     if (!Array.isArray(items) || items.length === 0)
//       return { status: false, message: "At least one item is required." };

//     // === Check if indent already exists ===
//     const existingIndent = await client.query(
//       `SELECT id FROM indents WHERE indent_no = $1`,
//       [indent_no]
//     );
//     if (existingIndent.rows.length)
//       return { status: false, message: `Indent number '${indent_no}' already exists.` };

//     // === Validate and check stock availability ===
//     for (const item of items) {
//       const { raw_material_id, weight, article_name } = item;

//       const rmRes = await client.query(
//         `SELECT total_qty, name FROM raw_materials WHERE id = $1`,
//         [raw_material_id]
//       );

//       if (!rmRes.rows.length) {
//         await client.query("ROLLBACK");
//         return {
//           status: false,
//           message: `Raw material not found for item '${article_name}'.`,
//         };
//       }

//       const availableQty = Number(rmRes.rows[0].total_qty || 0);
//       if (availableQty < weight) {
//         await client.query("ROLLBACK");
//         return {
//           status: false,
//           message: `Insufficient quantity for '${article_name}'. Available: ${availableQty}, Required: ${weight}`,
//         };
//       }
//     }

//     // === Insert into indents ===
//     const insertIndentQuery = `
//       INSERT INTO indents (indent_no, requested_by, status, indent_date, remarks)
//       VALUES ($1, $2, $3, $4, $5)
//       RETURNING id;
//     `;
//     const indentResult = await client.query(insertIndentQuery, [
//       indent_no,
//       userId,
//       status || "draft",
//       indent_date,
//       remarks || null,
//     ]);
//     const indentId = indentResult.rows[0].id;

//     // === Insert items & Deduct stock ===
//     for (const item of items) {
//       const { raw_material_id, article_name, weight, unit, rate } = item;

//       // Calculate value automatically
//       const value = Number(weight) * Number(rate);

//       await client.query(
//         `INSERT INTO indent_items (indent_id, raw_material_id, article_name, weight, unit, rate, value)
//          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
//         [indentId, raw_material_id, article_name, weight, unit, rate, value]
//       );

//       await client.query(
//         `UPDATE raw_materials
//          SET total_qty = total_qty - $1
//          WHERE id = $2`,
//         [weight, raw_material_id]
//       );
//     }

//     // === Auto calculation for totals ===
//     const totalValue = items.reduce((sum, item) => sum + Number(item.weight) * Number(item.rate), 0);
//     const profitPercentage = Number(calculation?.profit_percentage || 0);
//     const taxPercentage = Number(calculation?.tax_percentage || 0);
//     const roundOff = Number(calculation?.round_off || 0);

//     const profitAmount = (totalValue * profitPercentage) / 100;
//     const taxAmount = ((totalValue + profitAmount) * taxPercentage) / 100;
//     const finalAmount = totalValue + profitAmount + taxAmount + roundOff;

//     await client.query(
//       `INSERT INTO indent_calculations 
//        (indent_id, total_value, profit_percentage, profit_amount, tax_percentage, tax_amount, round_off, final_amount)
//        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
//       [
//         indentId,
//         totalValue,
//         profitPercentage,
//         profitAmount,
//         taxPercentage,
//         taxAmount,
//         roundOff,
//         finalAmount,
//       ]
//     );

//     // === Commit transaction ===
//     await client.query("COMMIT");

//     return {
//       status: true,
//       message: "Indent has been created successfully and stock updated.",
//       data: {
//         indent_id: indentId,
//         total_value: totalValue,
//         profit_amount: profitAmount,
//         tax_amount: taxAmount,
//         final_amount: finalAmount,
//       },
//     };
//   } catch (error) {
//     console.error("❌ Error in createIndentService:", error);
//     await client.query("ROLLBACK");
//     return { status: false, message: `Something went wrong (${error.message})` };
//   } finally {
//     client.release();
//   }
// };

exports.createIndentService = async (body, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { indent_no, indent_date, quantity, status, items, unit_master_id, calculation, remarks } = body;

    // === Basic Validation ===
    if (!indent_no) return { status: false, message: "Indent number is required." };
    if (!indent_date) return { status: false, message: "Indent date is required." };
    if (!unit_master_id) return { status: false, message: "unit_master_id is required." };
    if (!quantity) return { status: false, message: "quantity is required." };
    if (!Array.isArray(items) || items.length === 0)
      return { status: false, message: "At least one item is required." };

    // === Check if indent already exists ===
    const existingIndent = await client.query(
      `SELECT id FROM indents WHERE indent_no = $1`,
      [indent_no]
    );
    if (existingIndent.rows.length) {
      return { status: false, message: `Indent number '${indent_no}' already exists.` };
    }

    // === Validate stock for each item ===
    for (const item of items) {
      const { raw_material_id, weight, article_name } = item;

      const rmRes = await client.query(
        `SELECT total_qty FROM raw_materials WHERE id = $1`,
        [raw_material_id]
      );

      if (!rmRes.rows.length) {
        await client.query("ROLLBACK");
        return { status: false, message: `Raw material not found for '${article_name}'.` };
      }

      const availableQty = Number(rmRes.rows[0].total_qty || 0);
      if (availableQty < weight) {
        await client.query("ROLLBACK");
        return {
          status: false,
          message: `Insufficient quantity for '${article_name}'. Available: ${availableQty}, Required: ${weight}`,
        };
      }
    }

    // === Insert into indents ===
    const indentResult = await client.query(
      `INSERT INTO indents (indent_no, requested_by, status,quantity, indent_date,unit_master_id, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [indent_no, userId, status || "draft", quantity, indent_date, unit_master_id, remarks || null]
    );
    const indentId = indentResult.rows[0].id;

    // === Insert items & Deduct stock ===
    for (const item of items) {
      const { raw_material_id, article_name, weight, unit, rate, value } = item;

      await client.query(
        `INSERT INTO indent_items
         (indent_id, raw_material_id, article_name, weight, unit, rate, value)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [indentId, raw_material_id, article_name || "nil", weight, unit, rate, value]
      );

      await client.query(
        `UPDATE raw_materials SET total_qty = total_qty - $1 WHERE id = $2`,
        [weight, raw_material_id]
      );
    }

    // === Insert calculation ===
    await client.query(
      `INSERT INTO indent_calculations
       (indent_id, total_value, profit_percentage, profit_amount, tax_percentage, tax_amount, round_off, final_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        indentId,
        calculation.total_value,
        calculation.profit_percentage,
        calculation.profit_amount,
        calculation.tax_percentage,
        calculation.tax_amount,
        calculation.round_off,
        calculation.final_amount,
      ]
    );

    // === Commit transaction ===
    await client.query("COMMIT");

    return {
      status: true,
      message: "Indent created successfully and stock updated.",
      data: {
        indent_id: indentId,
        items,
        calculation,
      },
    };
  } catch (error) {
    console.error("❌ Error in createIndentService:", error);
    await client.query("ROLLBACK");
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};

// exports.getAllIndentService = async (query) => {
//   const client = await pool.connect();
//   try {
//     const {
//       search,
//       status,
//       unit_master_id,
//       start_date,
//       end_date,
//       sort_by = "indent_date",
//       sort_order = "DESC",
//       page = 1,
//       limit = 10
//     } = query;

//     let baseQuery = `
//   SELECT 
//       i.id, 
//       i.indent_no, 
//       i.indent_date, 
//       i.status, 
//       i.remarks,
//       i.quantity,
//       u.name AS requested_by_name,
//       um.unit_name,
//       ic.total_value,
//       ic.profit_percentage,
//       ic.profit_amount,
//       ic.tax_percentage,
//       ic.tax_amount,
//       ic.round_off,
//       ic.final_amount,
//       -- 🧮 Calculate per-unit cost
//       CASE 
//           WHEN i.quantity > 0 
//           THEN ROUND(ic.final_amount / i.quantity, 2)
//           ELSE 0
//       END AS per_unit_cost
//   FROM indents i
//   LEFT JOIN users u ON u.id = i.requested_by
//   LEFT JOIN unit_master um ON um.id = i.unit_master_id
//   LEFT JOIN indent_calculations ic ON ic.indent_id = i.id
//   WHERE 1=1
// `;


//     const values = [];
//     let counter = 1;

//     if (search) {
//       baseQuery += ` AND (i.indent_no ILIKE $${counter} OR u.name ILIKE $${counter})`;
//       values.push(`%${search}%`);
//       counter++;
//     }

//     if (status) {
//       baseQuery += ` AND i.status = $${counter}`;
//       values.push(status);
//       counter++;
//     }

//     if (unit_master_id) {
//       baseQuery += ` AND i.unit_master_id = $${counter}`;
//       values.push(unit_master_id);
//       counter++;
//     }

//     if (start_date && end_date) {
//       baseQuery += ` AND i.indent_date BETWEEN $${counter} AND $${counter + 1}`;
//       values.push(start_date, end_date);
//       counter += 2;
//     }

//     baseQuery += ` ORDER BY ${sort_by} ${sort_order}`;

//     let resultQuery = baseQuery;
//     let paginationInfo = {};

//     if (limit !== "all") {
//       const offset = (page - 1) * limit;
//       const countQuery = `SELECT COUNT(*) AS total FROM (${baseQuery}) AS total_table`;
//       const countResult = await client.query(countQuery, values);
//       const totalRecords = parseInt(countResult.rows[0].total, 10);

//       resultQuery += ` LIMIT $${counter} OFFSET $${counter + 1}`;
//       values.push(limit, offset);

//       paginationInfo = {
//         totalRecords,
//         totalPages: Math.ceil(totalRecords / limit),
//         currentPage: Number(page),
//         limit: Number(limit)
//       };
//     } else {
//       paginationInfo = { totalRecords: "all", totalPages: 1, currentPage: 1, limit: "all" };
//     }

//     const indentsResult = await client.query(resultQuery, values);
//     const indents = indentsResult.rows;

//     // === Fetch indent items for all indents ===
//     const indentIds = indents.map(i => i.id);
//     let itemsMap = {};

//     if (indentIds.length > 0) {
//       const itemsQuery = `
//         SELECT it.*, rm.name AS raw_material_name
//         FROM indent_items it
//         LEFT JOIN raw_materials rm ON rm.id = it.raw_material_id
//         WHERE it.indent_id = ANY($1)
//       `;
//       const itemsResult = await client.query(itemsQuery, [indentIds]);
//       itemsMap = itemsResult.rows.reduce((acc, item) => {
//         acc[item.indent_id] = acc[item.indent_id] || [];
//         acc[item.indent_id].push(item);
//         return acc;
//       }, {});
//     }

//     // === Attach items to indents ===
//     const finalData = indents.map(indent => ({
//       ...indent,
//       items: itemsMap[indent.id] || []
//     }));

//     return {
//       status: true,
//       message: "Indents fetched successfully.",
//       data: finalData,
//       pagination: paginationInfo
//     };
//   } catch (error) {
//     console.error("❌ Error in getAllIndentService:", error);
//     return { status: false, message: `Something went wrong (${error.message})` };
//   } finally {
//     client.release();
//   }
// };

exports.getAllIndentService = async (query) => {
  const client = await pool.connect();
  try {
    const {
      search,
      status,
      unit_master_id,
      start_date,
      end_date,
      sort_by = "indent_date",
      sort_order = "DESC",
      page = 1,
      limit = 10
    } = query;

    let baseQuery = `
      SELECT 
          i.id, 
          i.indent_no, 
          i.indent_date, 
          i.status, 
          i.remarks,
          i.quantity,
          u.name AS requested_by_name,
          um.unit_name,
          ic.total_value,
          ic.profit_percentage,
          ic.profit_amount,
          ic.tax_percentage,
          ic.tax_amount,
          ic.round_off,
          ic.final_amount,
          CASE 
              WHEN i.quantity > 0 
              THEN ROUND(ic.final_amount / i.quantity, 2)
              ELSE 0
          END AS per_unit_cost
      FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
      LEFT JOIN unit_master um ON um.id = i.unit_master_id
      LEFT JOIN indent_calculations ic ON ic.indent_id = i.id
      WHERE 1=1
    `;

    const values = [];
    let counter = 1;

    if (search) {
      baseQuery += ` AND (i.indent_no ILIKE $${counter} OR u.name ILIKE $${counter})`;
      values.push(`%${search}%`);
      counter++;
    }

    if (status) {
      baseQuery += ` AND i.status = $${counter}`;
      values.push(status);
      counter++;
    }

    if (unit_master_id) {
      baseQuery += ` AND i.unit_master_id = $${counter}`;
      values.push(unit_master_id);
      counter++;
    }

    if (start_date && end_date) {
      baseQuery += ` AND i.indent_date BETWEEN $${counter} AND $${counter + 1}`;
      values.push(start_date, end_date);
      counter += 2;
    }

    baseQuery += ` ORDER BY ${sort_by} ${sort_order}`;

    // === Count total records ===
    const countQuery = `SELECT COUNT(*) AS total FROM (${baseQuery}) AS total_table`;
    const countResult = await client.query(countQuery, values);
    const totalRecords = parseInt(countResult.rows[0].total, 10);

    // === Pagination ===
    let resultQuery = baseQuery;
    if (limit !== "all") {
      const offset = (page - 1) * limit;
      resultQuery += ` LIMIT $${counter} OFFSET $${counter + 1}`;
      values.push(limit, offset);
    }

    const indentsResult = await client.query(resultQuery, values);
    const indents = indentsResult.rows;

    // === Fetch indent items ===
    const indentIds = indents.map(i => i.id);
    let itemsMap = {};

    if (indentIds.length > 0) {
      const itemsQuery = `
        SELECT it.*, rm.name AS raw_material_name
        FROM indent_items it
        LEFT JOIN raw_materials rm ON rm.id = it.raw_material_id
        WHERE it.indent_id = ANY($1)
      `;
      const itemsResult = await client.query(itemsQuery, [indentIds]);
      itemsMap = itemsResult.rows.reduce((acc, item) => {
        acc[item.indent_id] = acc[item.indent_id] || [];
        acc[item.indent_id].push(item);
        return acc;
      }, {});
    }

    // === Attach items + totalRecords to each indent ===
    const finalData = indents.map(indent => ({
      ...indent,
      items: itemsMap[indent.id] || [],
      totalRecords // 👈 Add inside each object
    }));

    // ✅ Return totalRecords outside + inside each record
    return {
      status: true,
      message: "Indents fetched successfully.",
      totalRecords,
      data: finalData
    };

  } catch (error) {
    console.error("❌ Error in getAllIndentService:", error);
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};





exports.getAllIndentService2 = async (queryParams) => {
  try {
    let { page, limit, sortBy, sortOrder } = queryParams;
    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;
    sortBy = sortBy || 'created_at';
    sortOrder = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    let baseQuery = `
      SELECT 
        i.*,
        u.name AS requested_by_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ii.id,
              'indent_id', ii.indent_id,
              'raw_material_id', ii.raw_material_id,
              'qty', ii.qty,
              'price',ii.price,
              'uom', ii.uom,
              'notes', ii.notes,
              'raw_material', json_build_object(
                'id', rm.id,
                'code', rm.code,
                'name', rm.name,
                'description', rm.description,
                'uom', rm.uom,
                'category', rm.category,
                'batchable', rm.batchable,
                'reorder_level', rm.reorder_level
              )
            )
          ) FILTER (WHERE ii.id IS NOT NULL),
          '[]'
        ) AS items
      FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
      LEFT JOIN indent_items ii ON ii.indent_id = i.id
      LEFT JOIN raw_materials rm ON rm.id = ii.raw_material_id
      GROUP BY i.id, u.name
      ORDER BY ${sortBy} ${sortOrder}
    `;

    if (limit) {
      const offset = (page - 1) * limit;
      baseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    // Add the semicolon only once at the very end
    baseQuery += ';';

    const indents = await sqlQueryFun(baseQuery, []);
    const countResult = await sqlQueryFun(`SELECT COUNT(*) AS total FROM indents`, []);
    const total = parseInt(countResult[0]?.total || 0);

    return {
      status: true,
      data: { indents, total, page, limit: limit || total },
      message: 'Indents fetched successfully',
    };
  } catch (error) {
    return {
      status: false,
      data: [],
      message: error.message || 'Something went wrong while fetching indents',
    };
  }
};
exports.getAllIndentService3 = async (queryParams) => {
  try {
    let { page, limit, sortBy, sortOrder, search, status, priority } = queryParams;

    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;
    sortBy = sortBy || 'i.created_at';
    sortOrder = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    search = search ? search.trim() : '';

    // ✅ Base Query
    let baseQuery = `
      SELECT 
        i.*,
        u.name AS requested_by_name,
        -- ✅ Purchase Order Details if any
        json_build_object(
          'id', po.id,
          'purchase_order_id', po.purchase_order_id,
          'vendor_id', po.vendor_id,
          'status', po.status,
          'total_amount', po.total_amount,
          'order_date', po.order_date,
          'expected_delivery', po.expected_delivery
        ) AS purchase_order
      FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
      LEFT JOIN purchase_orders po ON po.indent_id = i.id
    `;

    // ✅ Dynamic filters
    let conditions = [];
    if (search) {
      conditions.push(`
        (LOWER(i.indent_no) LIKE LOWER('%${search}%') OR
         LOWER(u.name) LIKE LOWER('%${search}%'))
      `);
    }
    if (status) {
      conditions.push(`i.status = '${status}'`);
    }
    if (priority) {
      conditions.push(`i.priority = '${priority}'`);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ${conditions.join(' AND ')} `;
    }

    // ✅ Grouping & Sorting
    baseQuery += `
      GROUP BY i.id, u.name, po.id
      ORDER BY ${sortBy} ${sortOrder}
    `;

    // ✅ Pagination
    if (limit) {
      const offset = (page - 1) * limit;
      baseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    baseQuery += ';';

    const indents = await sqlQueryFun(baseQuery, []);

    // ✅ Total count for pagination
    let countQuery = `
      SELECT COUNT(*) AS total FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
    `;
    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')} `;
    }

    const countResult = await sqlQueryFun(countQuery, []);
    const total = parseInt(countResult[0]?.total || 0);

    return {
      status: true,
      data: {
        indents,
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.ceil(total / limit) : 1,
      },
      message: 'Indents fetched successfully',
    };
  } catch (error) {
    console.error('getAllIndentService error:', error);
    return {
      status: false,
      data: [],
      message: error.message || 'Something went wrong while fetching indents',
    };
  }
};

exports.deleteIndentService = async (id) => {
  try {
    if (!id) return { status: false, data: [], message: "Indent ID is required" };

    const checkQuery = `SELECT * FROM indents WHERE id = $1`;
    const existing = await sqlQueryFun(checkQuery, [id]);
    if (!existing.length) return { status: false, data: [], message: "Indent not found" };

    const deleteQuery = `DELETE FROM indents WHERE id = $1`;
    await sqlQueryFun(deleteQuery, [id])

    return { status: true, data: [], message: `Indent "${existing[0].indent_no}" has been deleted successfully` };
  } catch (error) {
    return { status: false, data: [], message: error.message }
  }
};

exports.updateIndentService1 = async (body, id) => {
  try {
    if (!id) return { status: false, data: [], message: "Indent ID is required" }

    const checkQuery = `SELECT * FROM indents WHERE id = $1`;
    const existing = await sqlQueryFun(checkQuery, [id]);
    if (!existing.length) return { status: false, data: [], message: "Indent not found" };

    const { indent_no, requested_by, status, required_by, priority, notes, items } = body;

    if (requested_by) {
      const userCheck = await sqlQueryFun(`SELECT * FROM users WHERE id = $1`, [requested_by]);
      if (!userCheck.length) return { status: false, data: [], message: "Requested user not found" };
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (indent_no) { fields.push(`indent_no = $${idx++}`); values.push(indent_no); }
    if (requested_by) { fields.push(`requested_by = $${idx++}`); values.push(requested_by); }
    if (status) { fields.push(`status = $${idx++}`); values.push(status); }
    if (required_by) { fields.push(`required_by = $${idx++}`); values.push(required_by); }
    if (priority) { fields.push(`priority = $${idx++}`); values.push(priority); }
    if (notes) { fields.push(`notes = $${idx++}`); values.push(notes); }

    if (fields.length === 0) return { status: false, data: [], message: "No fields to update" };

    values.push(id);

    const updateQuery = `UPDATE indents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;

    const result = await sqlQueryFun(updateQuery, values);

    return { status: true, data: result, message: "Indent updated successfully" };

  } catch (error) {
    return { status: false, data: [], message: error.message }
  }
};

exports.updateIndentService = async (body, id, userId) => {
  const client = await pool.connect();
  try {
    if (!id) return { status: false, message: "Indent ID is required." };

    await client.query("BEGIN");

    // Check if indent exists
    const existingIndent = await sqlQueryFun(`SELECT * FROM indents WHERE id=$1`, [id]);
    if (!existingIndent.length) {
      await client.query("ROLLBACK");
      return { status: false, message: "Indent not found." };
    }

    const { indent_no,quantity, status, batch_no, required_by, priority, notes } = body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (indent_no !== undefined) { fields.push(`indent_no=$${idx++}`); values.push(indent_no); }
    if (quantity !== undefined) { fields.push(`quantity=$${idx++}`); values.push(quantity); }
    if (status !== undefined) { fields.push(`status=$${idx++}`); values.push(status); }
    if (batch_no !== undefined) {
      if (!isUuid(batch_no)) throw new Error("Invalid batch_no UUID");
      fields.push(`batch_no=$${idx++}`);
      values.push(batch_no);
    }
    if (required_by !== undefined) { fields.push(`required_by=$${idx++}`); values.push(required_by); }
    if (priority !== undefined) { fields.push(`priority=$${idx++}`); values.push(priority); }
    if (notes !== undefined) { fields.push(`notes=$${idx++}`); values.push(notes); }

    let approved_by;
    if (status === "submitted") approved_by = userId;
    if (approved_by) { fields.push(`approved_by=$${idx++}`); values.push(approved_by); }

    if (fields.length > 0) {
      values.push(id);
      const updateQuery = `UPDATE indents SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`;
      const [updatedIndent] = await sqlQueryFun(updateQuery, values);
      await client.query("COMMIT");
      return { status: true, data: updatedIndent, message: "Indent updated successfully." };
    } else {
      await client.query("ROLLBACK");
      return { status: false, message: "No fields provided for update." };
    }

  } catch (error) {
    await client.query("ROLLBACK");
    return { status: false, message: `Failed to update indent. (${error.message})` };
  } finally {
    client.release();
  }
};

exports.getIndentByIdService = async (id) => {
  try {
    const query = `
      SELECT 
        i.*,
        u.name AS requested_by_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ii.id,
              'indent_id', ii.indent_id,
              'raw_material_id', ii.raw_material_id,
              'qty', ii.qty,
              'uom', ii.uom,
              'notes', ii.notes,
              'raw_material', json_build_object(
                'id', rm.id,
                'code', rm.code,
                'name', rm.name,
                'description', rm.description,
                'uom', rm.uom,
                'category', rm.category,
                'batchable', rm.batchable,
                'reorder_level', rm.reorder_level
              )
            )
          ) FILTER (WHERE ii.id IS NOT NULL),
          '[]'
        ) AS items
      FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
      LEFT JOIN indent_items ii ON ii.indent_id = i.id
      LEFT JOIN raw_materials rm ON rm.id = ii.raw_material_id
      WHERE i.id = $1
      GROUP BY i.id, u.name;
    `;

    const result = await sqlQueryFun(query, [id]);

    if (result.length === 0) {
      return {
        status: false,
        data: null,
        message: 'Indent not found',
      };
    }

    return {
      status: true,
      data: result[0],
      message: 'Indent fetched successfully',
    };
  } catch (error) {
    return {
      status: false,
      data: null,
      message: error.message || 'Something went wrong while fetching indent',
    };
  }
};