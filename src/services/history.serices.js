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
