const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createGrnService = async(body,userId)=>{
    try {
        const { grn_no,purchase_order_id,notes } = body
        const [ existGrn ] = await sqlQueryFun(`SELECT * FROM grns WHERE grn_no=$1`,[grn_no])
        if(existGrn) return { status:false,message:`The GRN(${grn_no}) number you entered already exists in our records. Please use a different GRN number`}
        
        const insertGrnQry = `INSERT INTO grns (grn_no, purchase_order_id, received_by,notes) VALUES ( $1, $2, $3, $4)
    RETURNING *`
    const insertGrnVal = [grn_no,purchase_order_id,userId,notes]

    const result = await sqlQueryFun(insertGrnQry,insertGrnVal)
    return { status:true,data:result[0],message:"GRN has been created successfully"}
    } catch (error) {
        return {
            status: false,
            message: `Something went wrong on our end. Please try again later. (${error.message})`
        }
    }
}

exports.getAllGrnService1 = async(query)=>{
    try {
    let { search, sortBy = "received_at", sortOrder = "DESC", limit, page } = query;
    let offset = 0;
    const values = [];

    let whereClause = "";
    if (search) {
      values.push(`%${search}%`);
      whereClause = `WHERE grn_no ILIKE $${values.length}`;
    }

    if (limit && page) {
      offset = (page - 1) * limit;
    }

    const paginationClause =
      limit && page ? `LIMIT $${values.length + 1} OFFSET $${values.length + 2}` : "";

    if (limit && page) {
      values.push(parseInt(limit), parseInt(offset));
    }

    const queryStr = `
      SELECT * FROM grns
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      ${paginationClause}
    `;

    const result = await sqlQueryFun(queryStr, values);

    // Total count for pagination
    const countQuery = `SELECT COUNT(*) FROM grns ${whereClause}`;
    const [countResult] = await sqlQueryFun(countQuery, search ? [`%${search}%`] : []);

    return {
      status: true,
      data: result,
      total: parseInt(countResult.count),
      message: "GRNs fetched successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
}

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

exports.updateGrnService = async (id, body) => {
  try {
    const { grn_no, purchase_order_id, notes } = body;

    const updateQuery = `
      UPDATE grns
      SET grn_no=$1, purchase_order_id=$2, notes=$3
      WHERE id=$4
      RETURNING *
    `;
    const result = await sqlQueryFun(updateQuery, [grn_no, purchase_order_id, notes, id]);

    if (!result.length) {
      return { status: false, message: "GRN not found." };
    }

    return { status: true, data: result[0], message: "GRN updated successfully." };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
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