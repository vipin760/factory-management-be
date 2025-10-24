const { pool } = require("../config/database");

const getPendingIndentsStatsFun = async (client) => {
    try {
        const currentQuery = `
    SELECT COUNT(*)::int AS count
    FROM indents
    WHERE status = 'pending'
    AND created_at >= date_trunc('week', CURRENT_DATE)
  `;

        const previousQuery = `
    SELECT COUNT(*)::int AS count
    FROM indents
    WHERE status = 'pending'
    AND created_at >= date_trunc('week', CURRENT_DATE - interval '1 week')
    AND created_at < date_trunc('week', CURRENT_DATE)
  `;

        const currentResult = await client.query(currentQuery);
        const previousResult = await client.query(previousQuery);

        const current = currentResult.rows[0].count;
        const previous = previousResult.rows[0].count;

        const percentageChange = previous === 0 ? 100 : ((current - previous) / previous) * 100;

        return {
            current,
            previous,
            change: `${percentageChange.toFixed(2)}%`,
            trend: current >= previous ? 'up' : 'down'
        };
    } catch (error) {
        console.log("<><>err", error)
    }
};
const getActiveBatchesStatsFun = async (client) => {
    const currentQuery = `
    SELECT COUNT(*)::int AS count
    FROM batches
    WHERE status = 'in_production'
    AND DATE(created_at) = CURRENT_DATE
  `;

    const previousQuery = `
    SELECT COUNT(*)::int AS count
    FROM batches
    WHERE status = 'in_production'
    AND DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
  `;

    const currentResult = await client.query(currentQuery);
    const previousResult = await client.query(previousQuery);

    const current = currentResult.rows[0].count;
    const previous = previousResult.rows[0].count;
    const diff = current - previous;

    return {
        current,
        previous,
        change: diff,
        trend: diff >= 0 ? 'up' : 'down'
    };
};
const getLowStockStatsFun = async (client) => {
    const currentQuery = `
    SELECT COUNT(*)::int AS count
    FROM raw_materials
    WHERE total_qty < reorder_level
  `;

    const previousQuery = `
    SELECT COUNT(*)::int AS count
    FROM raw_materials
    WHERE total_qty < reorder_level
    AND DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
  `;

    const currentResult = await client.query(currentQuery);
    const previousResult = await client.query(previousQuery);

    const current = currentResult.rows[0].count;
    const previous = previousResult.rows[0].count;
    const diff = current - previous;

    return {
        current,
        previous,
        change: diff,
        trend: diff >= 0 ? 'up' : 'down'
    };
};
const getCompletedOrdersStatsFun = async (client) => {
    const currentMonthQuery = `
    SELECT COUNT(*)::int AS count
    FROM purchase_orders
    WHERE status = 'completed'
    AND DATE_TRUNC('month', order_date) = DATE_TRUNC('month', CURRENT_DATE)
  `;

    const lastMonthQuery = `
    SELECT COUNT(*)::int AS count
    FROM purchase_orders
    WHERE status = 'completed'
    AND DATE_TRUNC('month', order_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
  `;

    const currentResult = await client.query(currentMonthQuery);
    const lastResult = await client.query(lastMonthQuery);

    const current = currentResult.rows[0].count;
    const last = lastResult.rows[0].count;

    const percentageChange = last === 0
        ? 100
        : (((current - last) / last) * 100).toFixed(2);

    return {
        current,
        last,
        percentageChange: Number(percentageChange),
        trend: current >= last ? 'up' : 'down'
    };
};

// services/dashboardService.js
exports.getDashboardData = async (params = {}) => {
    const client = await pool.connect();
    try {
        const now = new Date();

        // 1️⃣ Pending Indents (count where status = pending)
        const pendingIndentsQuery = `
            SELECT COUNT(*)::int AS count
            FROM indents
            WHERE status = 'draft';
        `;
        const { rows: [pendingIndents] } = await client.query(pendingIndentsQuery);

        // 2️⃣ Active Batches (in production)
        const activeBatchesQuery = `
            SELECT COUNT(*)::int AS count
            FROM batches
            WHERE status = 'in_progress';
        `;
        const { rows: [activeBatches] } = await client.query(activeBatchesQuery);

        // 3️⃣ Low Stock Items
        const lowStockQuery = `
            SELECT COUNT(*)::int AS count
            FROM raw_materials
            WHERE total_qty <= reorder_level;
        `;
        const { rows: [lowStockItems] } = await client.query(lowStockQuery);

        // 4️⃣ Completed Orders this month
        const completedOrdersQuery = `
            SELECT COUNT(*)::int AS count
            FROM purchase_orders
            WHERE status = 'completed'
            AND EXTRACT(MONTH FROM updated_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM updated_at) = EXTRACT(YEAR FROM CURRENT_DATE);
        `;
        const { rows: [completedOrders] } = await client.query(completedOrdersQuery);

        // 5️⃣ Recent Activity (last 10)

        const [getPendingIndentsStats, getLowStockStats, getCompletedOrdersStats, getActiveBatchesStats] = await Promise.all([getPendingIndentsStatsFun(client), getLowStockStatsFun(client), getCompletedOrdersStatsFun(client), getActiveBatchesStatsFun(client)])

        const pendingCountsQuery = `
  SELECT (
    (SELECT COUNT(*) FROM indents WHERE status = 'draft')
    +
    (SELECT COUNT(*) FROM purchase_orders WHERE status = 'draft')
  )::int AS total_pending;
`;
        const pendingCountsQueryRes = await client.query(pendingCountsQuery)
        return {
            status: true,
            message: 'Dashboard data fetched successfully',
            data: {
                cards: [
                    {
                        title: 'Pending Indents',
                        value: pendingIndents.count,
                        subtitle: 'Awaiting approval',
                        rate: getPendingIndentsStats
                    },
                    {
                        title: 'Active Batches',
                        value: activeBatches.count,
                        subtitle: 'In production',
                        rate: getActiveBatchesStats
                    },
                    {
                        title: 'Low Stock Items',
                        value: lowStockItems.count,
                        subtitle: 'Below reorder level',
                        rate: getLowStockStats
                    },
                    {
                        title: 'Completed Orders',
                        value: completedOrders.count,
                        subtitle: 'This month',
                        rate: getCompletedOrdersStats
                    }
                ],
                pendingApprovals: pendingCountsQueryRes.rows[0].total_pending, // could also list
            }
        };
    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.fetchRecentActivity = async (params = {}) => {
    const client = await pool.connect();
    try {
        let {
            page = 1,
            limit = 10,
            sortBy = 'timestamp',
            sortOrder = 'DESC',
            search = '',
            entityType = '',
            action = '',
            startDate = '',
            endDate = ''
        } = params;

        page = Number(page);
        limit = Number(limit);
        const offset = (page - 1) * limit;

        const values = [];
        const whereClauses = [];

        // ✅ Filters
        if (entityType) {
            values.push(entityType);
            whereClauses.push(`a.entity_type = $${values.length}`);
        }
        if (action) {
            values.push(action);
            whereClauses.push(`a.action = $${values.length}`);
        }
        if (startDate) {
            values.push(startDate);
            whereClauses.push(`a.timestamp >= $${values.length}`);
        }
        if (endDate) {
            values.push(endDate);
            whereClauses.push(`a.timestamp <= $${values.length}`);
        }
        if (search) {
            values.push(`%${search}%`);
            whereClauses.push(`(a.entity_type ILIKE $${values.length} OR a.action ILIKE $${values.length})`);
        }

        const whereQuery = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // ✅ Add LIMIT/OFFSET parameters **after** filters
        values.push(limit);
        values.push(offset);
        const limitIndex = values.length - 1;
        const offsetIndex = values.length;
const data1 = await client.query(`SELECT * FROM audit_logs`)
        const recentActivityQuery = `
      SELECT
        a.entity_type,
        a.action,
        a.timestamp,
        a.metadata,
        a.details,
        a.user_id,
        u.name AS user_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereQuery}
      ORDER BY a.${sortBy} ${sortOrder}
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
    `;

        const { rows: activityRows } = await client.query(recentActivityQuery, values);

        // 📊 Total Count for pagination (no limit/offset here)
        const countValues = values.slice(0, values.length - 2);
        const countQuery = `
      SELECT COUNT(*) FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereQuery};
    `;
        const { rows: countRows } = await client.query(countQuery, countValues);
        const totalRecords = parseInt(countRows[0].count, 10);
        const totalPages = Math.ceil(totalRecords / limit);

        // 🧠 Transform data
        const recentActivity = activityRows.map((row) => {
            let displayAction = '';

            if (row.entity_type === 'product' && row.action === 'create') {
                displayAction = `Product ${row.details?.product_code || ''} created`;
            } else if (row.entity_type === 'indent') {
                displayAction = `Indent ${row.details?.indent_no || ''} ${row.action}`;
            } else if (row.entity_type === 'po') {
                displayAction = `PO ${row.details?.po_no || ''} ${row.action}`;
            } else if (row.entity_type === 'batch') {
                displayAction = `Batch ${row.details?.batch_no || ''} ${row.action}`;
            } else if (row.entity_type === 'grn') {
                displayAction = `GRN ${row.details?.grn_no || ''} ${row.action}`;
            } else {
                displayAction = `${row.entity_type} ${row.action}`;
            }

            return {
                id:
                    row.details?.id ||
                    row.details?.product_code ||
                    row.details?.po_no ||
                    Math.random().toString(36).substr(2, 9),
                action: displayAction,
                user: row.user_name || 'Unknown',
                time: new Date(row.timestamp).toLocaleString(),
                type: row.entity_type
            };
        });

        return {
            status: true,
            message: 'Recent activity fetched successfully',
            data: recentActivity,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages
            }
        };
    } catch (error) {
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};


// /api/dashboard/pending-approval?page=2&limit=20
exports.fetchPendingApprovalService = async (params = {}) => {
    const client = await pool.connect();
    try {
        let {
            page = 1,
            limit = 10,
            sortBy = 'created_at',
            sortOrder = 'DESC',
            search = '',
            type = '' // indent / po
        } = params;

        page = Number(page);
        limit = Number(limit);
        const offset = (page - 1) * limit;

        const values = [];
        const whereClauses = ["status = 'draft'"];

        // ✅ Search filter
        if (search) {
            values.push(`%${search}%`);
            whereClauses.push(`(indent_no ILIKE $${values.length} OR purchase_order_id ILIKE $${values.length})`);
        }

        // ✅ Type filter (optional)
        let tableName = '';
        if (type === 'indent') {
            tableName = 'indents';
        } else if (type === 'po' || type === 'purchase_order') {
            tableName = 'purchase_orders';
        }

        // ✅ Build query dynamically for both tables
        let dataQuery = '';
        let countQuery = '';

        if (tableName === 'indents') {
            dataQuery = `
        SELECT id, indent_no AS reference_no, status, created_at
        FROM indents
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2};
      `;
            countQuery = `
        SELECT COUNT(*) FROM indents
        WHERE ${whereClauses.join(' AND ')};
      `;
        } else if (tableName === 'purchase_orders') {
            dataQuery = `
        SELECT id, purchase_order_id AS reference_no, status, created_at
        FROM purchase_orders
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2};
      `;
            countQuery = `
        SELECT COUNT(*) FROM purchase_orders
        WHERE ${whereClauses.join(' AND ')};
      `;
        } else {
            // If no type is provided, combine both tables
            dataQuery = `
        SELECT id, indent_no AS reference_no, status, created_at, 'indent' AS type
        FROM indents
        WHERE ${whereClauses.join(' AND ')}
        UNION ALL
        SELECT id, purchase_order_id AS reference_no, status, created_at, 'po' AS type
        FROM purchase_orders
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2};
      `;

            countQuery = `
        SELECT ( 
          (SELECT COUNT(*) FROM indents WHERE ${whereClauses.join(' AND ')})
          +
          (SELECT COUNT(*) FROM purchase_orders WHERE ${whereClauses.join(' AND ')})
        ) AS total;
      `;
        }

        // ✅ Add pagination values
        values.push(limit);
        values.push(offset);

        // 🔹 Execute main data query
        const { rows: pendingRows } = await client.query(dataQuery, values);

        // 🔹 Count total records for pagination
        const { rows: countRows } = await client.query(countQuery, values.slice(0, values.length - 2));
        const totalRecords = tableName
            ? parseInt(countRows[0].count, 10)
            : parseInt(countRows[0].total, 10);
        const totalPages = Math.ceil(totalRecords / limit);

        return {
            status: true,
            message: 'Pending approvals fetched successfully',
            data: pendingRows,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages
            }
        };
    } catch (error) {
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};




