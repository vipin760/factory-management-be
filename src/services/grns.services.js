const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createGrnService = async (body, userId) => {
  const client = await pool.connect();
  try {
    const { grn_no, purchase_order_id, gate_pass_number, notes } = body;
    await client.query('BEGIN');
    // validate
    const grno_exist = await sqlQueryFun(`SELECT purchase_order_id,grn_no FROM grns WHERE grn_no=$1`, [grn_no])
    if (grno_exist.length) return { status: false, message: `This grn_no(${grn_no}) already exist` }
    // 1. Validate Purchase Order
    const [poData] = await sqlQueryFun(
      `SELECT status, indent_id,vendor_id FROM purchase_orders WHERE id=$1`,
      [purchase_order_id]
    );
    if (!poData) {
      await client.query('ROLLBACK');
      return { status: false, message: "❌ Purchase order not found" };
    }
    if (poData.status == 'received') {
      await client.query('ROLLBACK');
      return {
        status: false,
        message: "⚠️ Purchase order is already recieved",
      }
    }

    if (!["approved"].includes(poData.status)) {
      await client.query('ROLLBACK');
      return {
        status: false,
        message: "⚠️ Purchase order is not approved yet. Waiting for admin approval.",
      };
    }

    // 2. Insert GRN
    const insertGrnQry = `
      INSERT INTO grns (grn_no, purchase_order_id, received_by, gate_pass_number, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`;
    const [grn] = await sqlQueryFun(insertGrnQry, [
      grn_no,
      purchase_order_id,
      userId,
      gate_pass_number,
      notes
    ]);

    const poItemsRes = await sqlQueryFun(
      `SELECT raw_material_id, qty FROM purchase_order_items WHERE purchase_order_id = $1`,
      [purchase_order_id]
    );
    const poItems = poItemsRes;
    for (const item of poItems) {
      const { raw_material_id, qty } = item;

      // Update total_qty in raw_materials
      await sqlQueryFun(
        `UPDATE raw_materials
         SET total_qty = total_qty + $1
         WHERE id = $2`,
        [qty, raw_material_id]
      );

    }


    await sqlQueryFun(`UPDATE purchase_orders SET status ='received' WHERE id = $1`, [purchase_order_id])

    await client.query('COMMIT');
    return {
      status: true,
      data: grn,
      message: "✅ GRN created successfully and stock movement recorded",
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error in createGrnService:", error);
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  } finally {
    client.release();
  }
};

exports.getAllGrnService = async (query) => {
  try {
    let { search, sortBy = "g.received_at", sortOrder = "DESC", limit, page } = query;
    let offset = 0;
    const values = [];

    // Build WHERE clause for search
    let whereClause = "";
    if (search) {
      values.push(`%${search}%`);
      whereClause = `WHERE g.grn_no ILIKE $${values.length}`;
    }

    // Pagination
    if (limit && page) {
      offset = (page - 1) * limit;
    }
    const paginationClause =
      limit && page ? `LIMIT $${values.length + 1} OFFSET $${values.length + 2}` : "";
    if (limit && page) {
      values.push(parseInt(limit), parseInt(offset));
    }

    // Query to fetch GRNs with purchase order and vendor info
    const queryStr1 = `
      SELECT
        g.id AS grn_id,
        g.grn_no,
        g.received_at,
        g.notes,
        g.gate_pass_number,
        g.received_by,
        po.id AS purchase_order_id,
        po.purchase_order_id,
        po.status AS purchase_order_status,
        po.total_amount AS purchase_order_total,
        v.id AS vendor_id,
        v.name AS vendor_name,
        v.contact_email AS vendor_email,
        v.phone AS vendor_phone,
        v.gstin AS vendor_gstin,
        v.address AS vendor_address,
        u.name AS received_by_name
      FROM grns g
      JOIN purchase_orders po ON g.purchase_order_id = po.id
      JOIN vendors v ON po.vendor_id = v.id
      JOIN users u ON g.received_by = u.id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      ${paginationClause}
    `;

    const queryStr = `
  SELECT
    g.id AS grn_id,
    g.grn_no,
    g.received_at,
    g.notes,
    g.gate_pass_number,
    g.received_by,
    po.id AS purchase_order_id,
    po.purchase_order_id,
    po.status AS purchase_order_status,
    po.total_amount AS purchase_order_total,
    v.id AS vendor_id,
    v.name AS vendor_name,
    v.contact_email AS vendor_email,
    v.phone AS vendor_phone,
    v.gstin AS vendor_gstin,
    v.address AS vendor_address,
    u.name AS received_by_name,
    json_agg(
      json_build_object(
        'file_id', f.id,
        'file_url', f.file_url
      )
    ) FILTER (WHERE f.id IS NOT NULL) AS uploaded_files
  FROM grns g
  JOIN purchase_orders po ON g.purchase_order_id = po.id
  JOIN vendors v ON po.vendor_id = v.id
  JOIN users u ON g.received_by = u.id
  LEFT JOIN purchase_order_files f ON po.id = f.purchase_order_id
  ${whereClause}
  GROUP BY
    g.id, g.grn_no, g.received_at, g.notes, g.gate_pass_number, g.received_by,
    po.id, po.purchase_order_id, po.status, po.total_amount,
    v.id, v.name, v.contact_email, v.phone, v.gstin, v.address,
    u.name
  ORDER BY ${sortBy} ${sortOrder}
  ${paginationClause};
`;


    const result = await sqlQueryFun(queryStr, values);

    // Total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM grns g
      JOIN purchase_orders po ON g.purchase_order_id = po.id
      JOIN vendors v ON po.vendor_id = v.id
      ${whereClause}
    `;
    const [countResult] = await sqlQueryFun(countQuery, search ? [`%${search}%`] : []);

    return {
      status: true,
      data: result,
      total: parseInt(countResult.total),
      message: "GRNs fetched successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};

exports.getSingleGrnService = async (grnId) => {
  try {
    if (!grnId) {
      return { status: false, message: "GRN ID is required." };
    }

    const values = [grnId];

    const queryStr = `
      SELECT
        g.id AS grn_id,
        g.grn_no,
        g.received_at,
        g.notes,
        g.gate_pass_number,
        g.received_by,
        po.id AS purchase_order_id,
        po.purchase_order_id,
        po.status AS purchase_order_status,
        po.total_amount AS purchase_order_total,
        v.id AS vendor_id,
        v.name AS vendor_name,
        v.contact_email AS vendor_email,
        v.phone AS vendor_phone,
        v.gstin AS vendor_gstin,
        v.address AS vendor_address,
        u.name AS received_by_name,
        json_agg(
          json_build_object(
            'file_id', f.id,
            'file_url', f.file_url
          )
        ) FILTER (WHERE f.id IS NOT NULL) AS uploaded_files
      FROM grns g
      JOIN purchase_orders po ON g.purchase_order_id = po.id
      JOIN vendors v ON po.vendor_id = v.id
      JOIN users u ON g.received_by = u.id
      LEFT JOIN purchase_order_files f ON po.id = f.purchase_order_id
      WHERE g.id = $1
      GROUP BY
        g.id, g.grn_no, g.received_at, g.notes, g.gate_pass_number, g.received_by,
        po.id, po.purchase_order_id, po.status, po.total_amount,
        v.id, v.name, v.contact_email, v.phone, v.gstin, v.address,
        u.name
      LIMIT 1;
    `;

    const result = await sqlQueryFun(queryStr, values);

    if (!result || result.length === 0) {
      return { status: false, message: "GRN not found." };
    }

    return {
      status: true,
      data: result[0],
      message: "GRN fetched successfully.",
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};


exports.getAllGrnService1 = async (query) => {
  try {
    let {
      search,
      sortBy = "g.received_at",
      sortOrder = "DESC",
      limit,
      page
    } = query;

    const values = [];
    let whereClause = "";

    // --- Search handling ---
    if (search) {
      values.push(`%${search}%`);
      whereClause = `WHERE g.grn_no ILIKE $${values.length}
                     OR po.po_no ILIKE $${values.length}
                     OR v.name ILIKE $${values.length}`;
    }

    // --- Pagination handling ---
    let paginationClause = "";
    if (limit && page) {
      const offset = (page - 1) * limit;
      values.push(parseInt(limit), parseInt(offset));
      paginationClause = `LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }

    // --- Main Query ---
    const queryStr = `
      SELECT
        g.id AS grn_id,
        g.grn_no,
        g.received_at,
        g.notes,
        g.gate_pass_number,
        g.received_by,
        po.id AS purchase_order_id,
        po.po_no,
        po.status AS purchase_order_status,
        po.total_value AS purchase_order_total,
        v.id AS vendor_id,
        v.name AS vendor_name,
        v.contact_email AS vendor_email,
        v.phone AS vendor_phone,
        v.gstin AS vendor_gstin,
        v.address AS vendor_address,
        u.name AS received_by_name
      FROM grns g
      JOIN purchase_orders po ON g.purchase_order_id = po.id
      JOIN vendors v ON po.vendor_id = v.id
      JOIN users u ON g.received_by = u.id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      ${paginationClause}
    `;

    const result = await sqlQueryFun(queryStr, values);

    // --- Count Query (must use same WHERE but no limit/offset) ---
    const countValues = search ? [`%${search}%`] : [];
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM grns g
      JOIN purchase_orders po ON g.purchase_order_id = po.id
      JOIN vendors v ON po.vendor_id = v.id
      ${whereClause}
    `;
    const [countResult] = await sqlQueryFun(countQuery, countValues);

    return {
      status: true,
      data: result,
      total: parseInt(countResult.total),
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : null,
      message: "GRNs fetched successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};

exports.updateGrnService = async (id, body, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Get existing GRN
    const grnRes = await sqlQueryFun(`SELECT * FROM grns WHERE id=$1`, [id]);
    if (!grnRes.length) {
      await client.query("ROLLBACK");
      return { status: false, message: "GRN not found." };
    }
    const existingGrn = grnRes[0];

    const { grn_no, gate_pass_number, notes, status } = body;

    // 2️⃣ Update GRN fields
    const fields = [];
    const values = [];
    let idx = 1;

    if (grn_no !== undefined) { fields.push(`grn_no=$${idx++}`); values.push(grn_no); }
    if (gate_pass_number !== undefined) { fields.push(`gate_pass_number=$${idx++}`); values.push(gate_pass_number); }
    if (notes !== undefined) { fields.push(`notes=$${idx++}`); values.push(notes); }

    if (fields.length > 0) {
      values.push(id);
      const updateQuery = `UPDATE grns SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`;
      const [updatedGrn] = await sqlQueryFun(updateQuery, values);
      existingGrn.grn_no = updatedGrn.grn_no;
      existingGrn.gate_pass_number = updatedGrn.gate_pass_number;
      existingGrn.notes = updatedGrn.notes;
    }

    // 3️⃣ Update Purchase Order status if passed
    if (status && existingGrn.purchase_order_id) {
      await sqlQueryFun(
        `UPDATE purchase_orders SET status=$1 WHERE id=$2`,
        [status, existingGrn.purchase_order_id]
      );
    }

    await client.query("COMMIT");

    return {
      status: true,
      data: existingGrn,
      message:
        "GRN updated successfully" +
        (status ? " and Purchase Order status updated." : "")
    };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      status: false,
      message: `Failed to update GRN. (${error.message})`
    };
  } finally {
    client.release();
  }
};

exports.deleteGrnService = async (id) => {
  try {
    const deleteQuery = `DELETE FROM grns WHERE id=$1 RETURNING *`;
    const result = await sqlQueryFun(deleteQuery, [id]);

    if (!result.length) {
      return { status: false, message: "GRN not found." };
    }

    return { status: true, data: result[0], message: "GRN deleted successfully." };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};