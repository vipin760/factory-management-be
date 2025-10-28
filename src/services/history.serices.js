const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction");


exports.getAllPurchaseHistoryService = async (queryParams) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sort_by = "changed_at",
      sort_order = "desc",
      purchase_order_id,
      user_id,
      start_date,
      end_date
    } = queryParams;

    const offset = (page - 1) * limit;
    const values = [];
    let whereClause = "WHERE 1=1";

    // Filter by purchase_order_id
    if (purchase_order_id) {
      values.push(purchase_order_id);
      whereClause += ` AND h.purchase_orders_id = $${values.length}`;
    }

    // Filter by changed_by user
    if (user_id) {
      values.push(user_id);
      whereClause += ` AND h.changed_by = $${values.length}`;
    }

    // Filter by date range
    if (start_date) {
      values.push(start_date);
      whereClause += ` AND h.changed_at >= $${values.length}`;
    }
    if (end_date) {
      values.push(end_date);
      whereClause += ` AND h.changed_at <= $${values.length}`;
    }

    // Search in remarks or status
    if (search) {
      values.push(`%${search}%`);
      values.push(`%${search}%`);
      whereClause += ` AND (h.remarks ILIKE $${values.length - 1} OR h.new_status ILIKE $${values.length})`;
    }

    // Sorting
    const allowedSortFields = ["changed_at", "new_status", "old_status", "new_qty", "new_rate"];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : "changed_at";
    const sortOrder = sort_order.toLowerCase() === "asc" ? "ASC" : "DESC";

    // Total count
    const countQuery = `SELECT COUNT(*) AS total FROM ordered_item_history h ${whereClause}`;
    const countRes = await sqlQueryFun(countQuery, values);
    const total = Number(countRes[0]?.total || 0);

    // Fetch paginated data
    const dataQuery = `
      SELECT 
        h.id,
        h.purchase_orders_id,
        h.changed_by,
        u.name AS changed_by_name,
        h.old_status,
        h.new_status,
        h.old_qty,
        h.new_qty,
        h.old_rate,
        h.new_rate,
        h.remarks,
        h.changed_at
      FROM ordered_item_history h
      LEFT JOIN users u ON h.changed_by = u.id
      ${whereClause}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;
    values.push(limit, offset);

    const history = await sqlQueryFun(dataQuery, values);

    return {
      status: true,
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      message: "Purchase order history fetched successfully",
    };
  } catch (error) {
    console.error("❌ Error in getAllPurchaseHistoryService:", error);
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};


exports.getAllIndentwisePurchaseHistoryService = async (query) => {
  try {
    const {
      indent_id,           // filter by indent
      raw_material_id,     // filter by raw material
      search,              // keyword search
      sort_by = "issue_date",  // sort column
      sort_order = "DESC",     // ASC or DESC
      page = 1,                // pagination
      limit = 10
    } = query;

    const offset = (page - 1) * limit;

    let baseQuery = `
      SELECT 
        r.id,
        r.issue_date,
        r.description,
        r.quantity_issued_kg,
        r.balance_kg,
        r.remarks,
        rm.name AS raw_material_name,
        rm.total_qty AS current_qty_raw_materials,
        i.indent_no AS indent_number,
        um.unit_name
      FROM rm_issue_register r
      LEFT JOIN raw_materials rm ON r.raw_material_id = rm.id
      LEFT JOIN indents i ON r.indent_no = i.id
      LEFT JOIN unit_master um ON i.unit_master_id = um.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Filter by indent_id
    if (indent_id) {
      baseQuery += ` AND r.indent_no = $${paramIndex++}`;
      params.push(indent_id);
    }

    // Filter by raw_material_id
    if (raw_material_id) {
      baseQuery += ` AND r.raw_material_id = $${paramIndex++}`;
      params.push(raw_material_id);
    }

    // Search in description or remarks
    if (search) {
      baseQuery += ` AND (LOWER(r.description) LIKE LOWER($${paramIndex}) OR LOWER(r.remarks) LIKE LOWER($${paramIndex}))`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Sorting
    const validSortColumns = [
      "issue_date",
      "quantity_issued_kg",
      "balance_kg",
      "raw_material_name",
      "indent_number"
    ];
    const orderByColumn = validSortColumns.includes(sort_by) ? sort_by : "issue_date";
    const orderDirection = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    baseQuery += ` ORDER BY ${orderByColumn} ${orderDirection}`;

    // Pagination
    baseQuery += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    // Execute main query
    const { rows } = await pool.query(baseQuery, params);

    // === Get total count for pagination info ===
    let countQuery = `SELECT COUNT(*) FROM rm_issue_register r WHERE 1=1`;
    const countParams = [];
    let countIndex = 1;

    if (indent_id) {
      countQuery += ` AND r.indent_no = $${countIndex++}`;
      countParams.push(indent_id);
    }
    if (raw_material_id) {
      countQuery += ` AND r.raw_material_id = $${countIndex++}`;
      countParams.push(raw_material_id);
    }
    if (search) {
      countQuery += ` AND (LOWER(r.description) LIKE LOWER($${countIndex}) OR LOWER(r.remarks) LIKE LOWER($${countIndex}))`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    // Add totalRecords inside each row
    const dataWithTotal = rows.map((row) => ({
      ...row,
      total_records: totalRecords,
    }));
const pagination = {
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        currentPage: Number(page),
        limit: Number(limit),
      }
    return {
      status: true,
      message: "RM Issue Register fetched successfully.",
      data: {data:dataWithTotal,pagination }
    };
  } catch (error) {
    console.error("❌ Error in getAllIndentwisePurchaseHistory:", error);
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};
