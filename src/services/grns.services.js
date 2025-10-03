const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createGrnService1 = async (body, userId) => {
  try {
    const { grn_no, purchase_order_id, gate_pass_number, notes } = body
    const [existGrn] = await sqlQueryFun(`SELECT * FROM grns WHERE grn_no=$1`, [grn_no])
    if (existGrn) return { status: false, message: `The GRN(${grn_no}) number you entered already exists in our records. Please use a different GRN number` }

    const insertGrnQry = `INSERT INTO grns (grn_no, purchase_order_id, received_by,gate_pass_number,notes) VALUES ( $1, $2, $3, $4,$5)RETURNING *`
    const insertGrnVal = [grn_no, purchase_order_id, userId, gate_pass_number, notes]

    const result = await sqlQueryFun(insertGrnQry, insertGrnVal)

    return { status: true, data: result[0], message: "GRN has been created successfully" }
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    }
  }
}

exports.createGrnService2 = async (body, userId) => {
  try {
    const { grn_no, purchase_order_id, gate_pass_number, notes } = body
    const [existGrn] = await sqlQueryFun(`SELECT * FROM grns WHERE grn_no=$1`, [grn_no])
    if (existGrn) return { status: false, message: `The GRN(${grn_no}) number you entered already exists in our records. Please use a different GRN number` }

    const insertGrnQry = `INSERT INTO grns (grn_no, purchase_order_id, received_by,gate_pass_number,notes) VALUES ( $1, $2, $3, $4,$5)
    RETURNING *`
    const insertGrnVal = [grn_no, purchase_order_id, userId, gate_pass_number, notes]

    const result = await sqlQueryFun(insertGrnQry, insertGrnVal)

    return { status: true, data: result[0], message: "GRN has been created successfully" }
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    }
  }
}

exports.createGrnService3 = async (body, userId) => {
  try {
    const { grn_no, purchase_order_id, gate_pass_number, notes } = body
    // const [existGrn] = await sqlQueryFun(`SELECT * FROM grns WHERE grn_no=$1`, [grn_no])
    // if (existGrn) return { status: false, message: `The GRN(${grn_no}) number you entered already exists in our records. Please use a different GRN number` }

    const insertGrnQry = `INSERT INTO grns (grn_no, purchase_order_id, received_by,gate_pass_number,notes) VALUES ( $1, $2, $3, $4,$5)RETURNING *`
    const insertGrnVal = [grn_no, purchase_order_id, userId, gate_pass_number, notes]

    // const result = await sqlQueryFun(insertGrnQry, insertGrnVal)
    const purchase_orderData = await sqlQueryFun(`SELECT batch_no FROM purchase_orders WHERE id=$1`, [purchase_order_id])
    let { batch_no } = purchase_orderData[0]
    const puchasedItems = await sqlQueryFun(`SELECT * FROM raw_material_batches WHERE batch_no=$1`, [batch_no])
    console.log("<><>puchasedItems",puchasedItems)
    return { status: true, data: "result[0]", purchase_orderData, message: "GRN has been created successfully" }
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    }
  }
}

exports.createGrnService = async (body, userId) => {
  try {
    const { grn_no, purchase_order_id, gate_pass_number, notes } = body;

    // 1. Validate Purchase Order
    const [poData] = await sqlQueryFun(
      `SELECT status, batch_no FROM purchase_orders WHERE id=$1`,
      [purchase_order_id]
    );
    if (!poData) {
      return { status: false, message: "❌ Purchase order not found" };
    }
    if (poData.status !== "approved") {
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
      notes,
    ]);

    // 3. Fetch Purchase Order Items
    const purchase_items = await sqlQueryFun(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id=$1`,
      [purchase_order_id]
    );
    if (!purchase_items.length) {
      return { status: false, message: "⚠️ No items found in this purchase order" };
    }

    // 4. Process each item
  for (const item of purchase_items) {
  const { id: purchase_order_item_id, raw_material_id } = item;
  const qty = Number(item.qty);     // ✅ force numeric
  const rate = Number(item.rate);   // ✅ force numeric

  // Ensure batch exists
  let [batch] = await sqlQueryFun(
    `SELECT id FROM raw_material_batches WHERE raw_material_id=$1 AND batch_no=$2`,
    [raw_material_id, poData.batch_no]
  );

  if (!batch) {
    [batch] = await sqlQueryFun(
      `INSERT INTO raw_material_batches (raw_material_id, batch_no, qty_received, qty_available, cost_per_unit)
       VALUES ($1, $2, 0, 0, 0) RETURNING id`,
      [raw_material_id, poData.batch_no]
    );
  }

  const raw_material_batch_id = batch.id;

  // Insert GRN item
  const [grnItem] = await sqlQueryFun(
    `INSERT INTO grn_items 
      (grn_id, purchase_order_item_id, raw_material_batch_id, qty, cost_per_unit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [grn.id, purchase_order_item_id, raw_material_batch_id, qty, rate]
  );

  // Insert stock movement
  await sqlQueryFun(
    `INSERT INTO raw_material_movements 
      (raw_material_batch_id, movement_type, qty, cost_per_unit, reference_type, reference_id)
     VALUES ($1, 'in', $2, $3, 'GRN', $4)`,
    [raw_material_batch_id, qty, rate, grnItem.id]
  );

  // ✅ Update batch quantities
  await sqlQueryFun(
    `UPDATE raw_material_batches
     SET 
       qty_received = qty_received + $1,
       qty_available = qty_available + $1,
       cost_per_unit = $2
     WHERE id = $3`,
    [qty, rate, raw_material_batch_id]
  );

  // Update PO item received_qty
  await sqlQueryFun(
    `UPDATE purchase_order_items
     SET received_qty = received_qty + $1
     WHERE id = $2`,
    [qty, purchase_order_item_id]
  );
}


    return {
      status: true,
      data: grn,
      message: "✅ GRN created successfully and stock movement recorded",
    };
  } catch (error) {
    console.error("❌ Error in createGrnService:", error);
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
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


exports.updateGrnService = async (id, body) => {
  try {
    // Get GRN first
    const grnRes = await sqlQueryFun(`SELECT * FROM grns WHERE id = $1`, [id]);

    if (!grnRes.length) {
      return { status: false, message: "GRN not found." };
    }

    const updatedGrn = grnRes[0];

    // --- If frontend passed "status", update purchase_order ---
    if (body.status && updatedGrn.purchase_order_id) {
      await sqlQueryFun(
        `UPDATE purchase_orders 
         SET status = $1 
         WHERE id = $2`,
        [body.status, updatedGrn.purchase_order_id]
      );
    }

    return {
      status: true,
      data: updatedGrn,
      message:
        "GRN fetched successfully" +
        (body.status ? " and Purchase Order status updated." : "")
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`
    };
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