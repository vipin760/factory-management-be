const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction")
const { validate: isUuid } = require('uuid');

exports.createIndentService = async (body, userId) => {
  console.log("<><>working...")
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      indent_no,
      indent_date,
      quantity,
      status,
      items,
      unit_master_id,
      calculation,
      remarks,
    } = body;

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
      `INSERT INTO indents (indent_no, requested_by, status, quantity, indent_date, unit_master_id, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [indent_no, userId, status || "draft", quantity, indent_date, unit_master_id, remarks || null]
    );
    const indentId = indentResult.rows[0].id;

    // === Insert items & Deduct stock ===
    for (const item of items) {
      const { raw_material_id, weight, rate, value } = item;

      // Insert each item into indent_items
      await client.query(
        `INSERT INTO indent_items
     (indent_id, raw_material_id, weight, rate, value)
     VALUES ($1,$2,$3,$4,$5)`,
        [indentId, raw_material_id, weight, rate, value]
      );

      // Update raw_materials quantity
      await client.query(
        `UPDATE raw_materials SET total_qty = total_qty - $1 WHERE id = $2`,
        [weight, raw_material_id]
      );

      // Fetch raw material details for article name and remaining qty
      const { rows } = await client.query(
        `SELECT name, total_qty FROM raw_materials WHERE id = $1`,
        [raw_material_id]
      );
      const rawMaterial = rows[0];
      const articleName = rawMaterial?.name || "Unknown Material";
      const totalBalance = rawMaterial?.total_qty || 0;

      // Construct dynamic remarks
      const remarks = `Issued ${weight}kg of ${articleName} for Indent #${indent_no}. Remaining ${totalBalance}kg.`;

      // Insert record into rm_issue_register
      await client.query(
        `INSERT INTO rm_issue_register
       (issue_date, description, indent_no,raw_material_id, quantity_issued_kg, balance_kg, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          indent_date,
          articleName,
          indentId,
          raw_material_id,
          weight,
          totalBalance,
          remarks,
        ]
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
    console.log("❌ Error in createIndentService2:", error);
    await client.query("ROLLBACK");
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};

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
        SELECT it.*, rm.name AS raw_material_name,rm.name AS article_name
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


exports.updateIndentService = async (body, id, userId) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const { indent_no, unit_master_id, quantity, indent_date, status, items, calculation, remarks } = body;

    if (!id) return { status: false, message: "Indent ID is required." };
    // === Check if indent exists ===
    const { rows: existingIndent } = await client.query(
      `SELECT * FROM indents WHERE id = $1`,
      [id]
    );
    if (!existingIndent.length)
      return { status: false, message: "Indent not found." };

    // === Dynamically update only changed fields ===
    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    if (indent_no) {
      updateFields.push(`indent_no = $${idx++}`);
      updateValues.push(indent_no);
    }
    if (status) {
      updateFields.push(`status = $${idx++}`);
      updateValues.push(status);
    }
    if (quantity) {
      updateFields.push(`quantity = $${idx++}`);
      updateValues.push(quantity);
    }
    if (indent_date) {
      updateFields.push(`indent_date = $${idx++}`);
      updateValues.push(indent_date);
    }
    if (unit_master_id) {
      updateFields.push(`unit_master_id = $${idx++}`);
      updateValues.push(unit_master_id);
    }
    if (remarks) {
      updateFields.push(`remarks = $${idx++}`);
      updateValues.push(remarks);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      await client.query(
        `UPDATE indents 
         SET ${updateFields.join(", ")}, updated_at = now()
         WHERE id = $${idx}`,
        updateValues
      );
    }

    await client.query("COMMIT");


    return {
      status: true,
      message: "Indent updated successfully with partial fields."
    };

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

exports.getAllRawMaterialsWithindentwise = async (params,query) => {
  try {
    const { indent_id } = params;
    const { page = 1, limit = 10 } = query

    if (!indent_id) {
      return { status: false, message: "indent_id is required" };
    }

    // Convert page/limit to numbers and calculate offset
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    // Main query with pagination
    const indentQry = `
      SELECT 
        i.id AS indent_id,
        i.indent_no,
        i.indent_date,
        i.status,
        i.remarks,

        ii.id AS indent_item_id,
        ii.weight,
        ii.unit,
        ii.rate,
        ii.value,

        rm.id AS raw_material_id,
        rm.code AS raw_material_code,
        rm.name AS raw_material_name,
        rm.uom AS raw_material_uom,
        rm.category AS raw_material_category,
        rm.batchable,
        rm.reorder_level,
        rm.total_qty

      FROM indents i
      LEFT JOIN indent_items ii ON i.id = ii.indent_id
      LEFT JOIN raw_materials rm ON ii.raw_material_id = rm.id
      WHERE i.id = $1
      ORDER BY rm.name ASC
      LIMIT $2 OFFSET $3;
    `;

    // Total count (for pagination metadata)
    const countQry = `
      SELECT COUNT(*) AS total
      FROM indent_items ii
      WHERE ii.indent_id = $1;
    `;

    // Run both queries
    const indentData = await sqlQueryFun(indentQry, [indent_id, limitNum, offset]);
    const totalResult = await sqlQueryFun(countQry, [indent_id]);
    const total = Number(totalResult[0]?.total || 0);
    const totalPages = Math.ceil(total / limitNum);

     const pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      }
    return {
      status: true,
      message: "Raw materials fetched successfully",
      data: {data:indentData,pagination}
    };
  } catch (error) {
    console.error("Error in getAllRawMaterialsWithindentwise:", error);
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};
