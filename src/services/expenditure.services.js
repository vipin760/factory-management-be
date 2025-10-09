const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction");
const { Parser } = require('json2csv'); // for CSV export

exports.getMonthlyExpensesReportService1 = async () => {
    const client = await pool.connect();

    try {
        // 1️⃣ Aggregate monthly production costs including utility expenses
        const monthlyCostsQuery = `
            SELECT
                TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS total_material_cost,
                COALESCE(SUM(be.total_cost), 0) AS total_operation_expense,
                COALESCE(SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END), 0) AS utility_expense,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS total_production_cost,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS grand_total_cost,
                MAX(pb.created_at) AS last_updated
            FROM production_batches pb
            LEFT JOIN batch_raw_material_consumptions brmc 
                ON pb.id = brmc.production_batch_id
            LEFT JOIN batch_expenses be 
                ON pb.id = be.production_batch_id
            GROUP BY TO_CHAR(pb.created_at, 'YYYY-MM')
            ORDER BY month ASC;
        `;
        const monthlyCostsResult = await client.query(monthlyCostsQuery);

        const monthlyCosts = monthlyCostsResult.rows.map((row, index, arr) => {
            const current = {
                month: row.month,
                total_material_cost: Number(row.total_material_cost),
                total_operation_expense: Number(row.total_operation_expense),
                utility_expense: Number(row.utility_expense),
                total_production_cost: Number(row.total_production_cost),
                grand_total_cost: Number(row.grand_total_cost),
                last_updated: row.last_updated
            };

            if (index === 0) {
                return {
                    ...current,
                    change_from_last_month: {
                        total_material_cost: "0",
                        total_operation_expense: "0",
                        utility_expense: "0",
                        total_production_cost: "0",
                        grand_total_cost: "0"
                    }
                };
            }

            const prev = arr[index - 1];
            const calcChange = (currentVal, prevVal) => {
                if (prevVal === 0) return currentVal === 0 ? 0 : "N/A";
                return parseFloat((((currentVal - prevVal) / prevVal) * 100).toFixed(2));
            };

            return {
                ...current,
                change_from_last_month: {
                    total_material_cost: calcChange(current.total_material_cost, Number(prev.total_material_cost)),
                    total_operation_expense: calcChange(current.total_operation_expense, Number(prev.total_operation_expense)),
                    utility_expense: calcChange(current.utility_expense, Number(prev.utility_expense)),
                    total_production_cost: calcChange(current.total_production_cost, Number(prev.total_production_cost)),
                    grand_total_cost: calcChange(current.grand_total_cost, Number(prev.grand_total_cost))
                }
            };
        });

        // 2️⃣ Detailed batch-wise cost records
        const detailedRecordsQuery = `
            WITH batch_material_cost AS (
                SELECT 
                    b.id AS batch_id,
                    SUM(poi.qty * poi.rate) AS total_material_cost
                FROM purchase_order_items poi
                JOIN purchase_orders po ON poi.purchase_order_id = po.id
                JOIN indents i ON po.indent_id = i.id
                JOIN batches b ON i.batch_no = b.id
                GROUP BY b.id
            ),
            batch_operation_cost AS (
                SELECT 
                    pb.batch_id,
                    SUM(be.total_cost) AS total_operation_expense,
                    SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END) AS utility_expense,
                    MAX(be.created_at) AS last_updated
                FROM batch_expenses be
                JOIN production_batches pb ON pb.id = be.production_batch_id
                GROUP BY pb.batch_id
            ),
            combined_costs AS (
                SELECT 
                    b.id AS batch_id,
                    b.batch_no,
                    p.product_name,
                    COALESCE(bmc.total_material_cost, 0) AS total_material_cost,
                    COALESCE(boc.total_operation_expense, 0) AS total_operation_expense,
                    COALESCE(boc.utility_expense, 0) AS utility_expense,
                    (COALESCE(bmc.total_material_cost, 0) + COALESCE(boc.total_operation_expense, 0)) AS total_cost,
                    TO_CHAR(b.created_at, 'YYYY-MM-DD') AS date,
                    COALESCE(boc.last_updated, b.created_at) AS last_updated
                FROM batches b
                JOIN products p ON b.product_id = p.id
                LEFT JOIN batch_material_cost bmc ON b.id = bmc.batch_id
                LEFT JOIN batch_operation_cost boc ON b.id = boc.batch_id
            )
            SELECT 
                CONCAT('Production Batch - ', product_name) AS title,
                batch_no AS ref_no,
                date,
                total_material_cost,
                total_operation_expense,
                utility_expense,
                total_cost,
                last_updated
            FROM combined_costs
            ORDER BY date DESC;
        `;
        const detailedRecordsResult = await client.query(detailedRecordsQuery);

        const detailedRecords = detailedRecordsResult.rows.map(row => ({
            title: row.title,
            date: row.date,
            material_cost: Number(row.total_material_cost || 0),
            operation_expense: Number(row.total_operation_expense || 0),
            utility_expense: Number(row.utility_expense || 0),
            amount: Number(row.total_cost || 0),
            ref_no: row.ref_no || null,
            type: "expense",
            last_updated: row.last_updated
        }));

        // 3️⃣ Vendor-wise total payment
        const vendorPaymentQuery = `
            SELECT 
                v.id AS vendor_id,
                v.name AS vendor_name,
                SUM(po.total_amount) AS total_payment
            FROM vendors v
            LEFT JOIN purchase_orders po ON po.vendor_id = v.id
            GROUP BY v.id, v.name
            ORDER BY total_payment DESC;
        `;
        const vendorPaymentResult = await client.query(vendorPaymentQuery);

        const vendorPayments = vendorPaymentResult.rows.map(row => ({
            vendor_id: row.vendor_id,
            vendor_name: row.vendor_name,
            total_payment: Number(row.total_payment || 0)
        }));

        // 4️⃣ Total Utility Expenses
        const utilityExpenseQuery = `
            SELECT 
                'Factory Utilities' AS name,
                MAX(created_at) AS last_updated,
                COALESCE(SUM(total_cost),0) AS amount
            FROM batch_expenses
            WHERE expense_category='utility';
        `;
        const utilityExpenseResult = await client.query(utilityExpenseQuery);

        const utilityExpenses = utilityExpenseResult.rows.map(row => ({
            name: row.name,
            date: row.last_updated ? row.last_updated : null,
            amount: Number(row.amount || 0),
            type: "expense"
        }));

        // ✅ Return structured report
        return {
            status: true,
            data: {
                monthlyCosts,
                detailedRecords,
                vendorPayments,
                utilityExpenses
            },
            message: "Monthly production, expense, utility expenses, and vendor payments report fetched successfully"
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

// expenditure.services.js
exports.getMonthlyExpensesReportService2 = async (params = {}) => {
    const client = await pool.connect();

    try {
        const {
            page = 1,
            limit = 20,
            category = "",
            type = '',
            startDate = null,
            endDate = null,
            search = null,
            sortBy = 'date',
        } = params;

        const monthlyCostsQuery = `
            SELECT
                TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS total_material_cost,
                COALESCE(SUM(be.total_cost), 0) AS total_operation_expense,
                COALESCE(SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END), 0) AS utility_expense,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS total_production_cost,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS grand_total_cost,
                MAX(pb.created_at) AS last_updated
            FROM production_batches pb
            LEFT JOIN batch_raw_material_consumptions brmc 
                ON pb.id = brmc.production_batch_id
            LEFT JOIN batch_expenses be 
                ON pb.id = be.production_batch_id
            GROUP BY TO_CHAR(pb.created_at, 'YYYY-MM')
            ORDER BY month ASC;
        `;
        const monthlyCostsResult = await client.query(monthlyCostsQuery);

        const monthlyCosts = monthlyCostsResult.rows.map((row, index, arr) => {
            const current = {
                month: row.month,
                total_material_cost: Number(row.total_material_cost),
                total_operation_expense: Number(row.total_operation_expense),
                utility_expense: Number(row.utility_expense),
                total_production_cost: Number(row.total_production_cost),
                grand_total_cost: Number(row.grand_total_cost),
                last_updated: row.last_updated
            };

            if (index === 0) {
                return {
                    ...current,
                    change_from_last_month: {
                        total_material_cost: "0",
                        total_operation_expense: "0",
                        utility_expense: "0",
                        total_production_cost: "0",
                        grand_total_cost: "0"
                    }
                };
            }

            const prev = arr[index - 1];
            const calcChange = (currentVal, prevVal) => {
                if (prevVal === 0) return currentVal === 0 ? 0 : "N/A";
                return parseFloat((((currentVal - prevVal) / prevVal) * 100).toFixed(2));
            };

            return {
                ...current,
                change_from_last_month: {
                    total_material_cost: calcChange(current.total_material_cost, Number(prev.total_material_cost)),
                    total_operation_expense: calcChange(current.total_operation_expense, Number(prev.total_operation_expense)),
                    utility_expense: calcChange(current.utility_expense, Number(prev.utility_expense)),
                    total_production_cost: calcChange(current.total_production_cost, Number(prev.total_production_cost)),
                    grand_total_cost: calcChange(current.grand_total_cost, Number(prev.grand_total_cost))
                }
            };
        });

        const offset = (page - 1) * limit;
        const orderBy = sortBy === 'amount' ? 'amount DESC' : 'date DESC';

        // 1️⃣ Summary Query
        const summaryQuery = `
      SELECT
        COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) AS total_material_cost,
        COALESCE(SUM(be.total_cost),0) AS total_production_cost,
        COALESCE(SUM(oe.amount),0) AS total_operations_cost,
        (COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) +
         COALESCE(SUM(be.total_cost),0) +
         COALESCE(SUM(oe.amount),0)) AS total_expenses
      FROM production_batches pb
      LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
      LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
      LEFT JOIN operation_expenses oe ON pb.id = oe.production_batch_id
      WHERE ($1::date IS NULL OR pb.created_at >= $1)
        AND ($2::date IS NULL OR pb.created_at <= $2);
    `;
        const summaryResult = await client.query(summaryQuery, [startDate, endDate]);
        const summary = summaryResult.rows[0];

        // 2️⃣ Detailed Data with Pagination
        const detailedQuery = `
      SELECT * FROM (
        -- Materials
        SELECT 
          rm.name || ' Purchase' AS title,
          (poi.qty * poi.rate)::numeric AS amount,
          'cost' AS type,
          'material' AS category,
          po.purchase_order_id::text AS ref_no,
          po.order_date AS date
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN raw_materials rm ON rm.id = poi.raw_material_id
        WHERE ($3::text IS NULL OR 'material' = $3)
          AND ($4::text IS NULL OR 'cost' = $4)
          AND ($1::date IS NULL OR po.order_date >= $1)
          AND ($2::date IS NULL OR po.order_date <= $2)
          AND ($7::text IS NULL OR rm.name ILIKE '%' || $7 || '%' OR po.purchase_order_id::text ILIKE '%' || $7 || '%')

        UNION ALL

        -- Production batches
        SELECT 
          'Production Batch - ' || p.product_name AS title,
          (COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) + COALESCE(SUM(be.total_cost),0))::numeric AS amount,
          'cost' AS type,
          'production' AS category,
          pb.batch_id::text AS ref_no,
          pb.created_at AS date
        FROM production_batches pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
        LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
        WHERE ($3::text IS NULL OR 'production' = $3)
          AND ($4::text IS NULL OR 'cost' = $4)
          AND ($1::date IS NULL OR pb.created_at >= $1)
          AND ($2::date IS NULL OR pb.created_at <= $2)
          AND ($7::text IS NULL OR p.product_name ILIKE '%' || $7 || '%' OR pb.batch_id::text ILIKE '%' || $7 || '%')
        GROUP BY pb.id, p.product_name

        UNION ALL

        -- Operations / Utility
        SELECT
          'Factory Utilities' AS title,
          SUM(total_cost)::numeric AS amount,
          'expense' AS type,
          'operation' AS category,
          NULL::text AS ref_no,
          created_at AS date
        FROM batch_expenses
        WHERE expense_category='utility'
          AND ($3::text IS NULL OR 'operation' = $3)
          AND ($4::text IS NULL OR 'expense' = $4)
          AND ($1::date IS NULL OR created_at >= $1)
          AND ($2::date IS NULL OR created_at <= $2)
          AND ($7::text IS NULL OR 'Factory Utilities' ILIKE '%' || $7 || '%')
        GROUP BY created_at
      ) AS combined
      ORDER BY ${orderBy}
      LIMIT $5::INTEGER OFFSET $6::INTEGER;
    `;
        const detailedResult = await client.query(detailedQuery, [
            startDate,
            endDate,
            category,
            type,
            limit,
            offset,
            search,
        ]);

        // 3️⃣ Count Query (⚠️ limit/offset removed here)
        const countQuery = `
      SELECT COUNT(*) AS total_count FROM (
        SELECT po.purchase_order_id::text AS id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN raw_materials rm ON rm.id = poi.raw_material_id
        WHERE ($1::text IS NULL OR 'material' = $1)
          AND ($2::text IS NULL OR 'cost' = $2)
          AND ($3::date IS NULL OR po.order_date >= $3)
          AND ($4::date IS NULL OR po.order_date <= $4)
          AND ($5::text IS NULL OR rm.name ILIKE '%' || $5 || '%' OR po.purchase_order_id::text ILIKE '%' || $5 || '%')

        UNION ALL

        SELECT pb.batch_id::text AS id
        FROM production_batches pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
        LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
        WHERE ($1::text IS NULL OR 'production' = $1)
          AND ($2::text IS NULL OR 'cost' = $2)
          AND ($3::date IS NULL OR pb.created_at >= $3)
          AND ($4::date IS NULL OR pb.created_at <= $4)
          AND ($5::text IS NULL OR p.product_name ILIKE '%' || $5 || '%' OR pb.batch_id::text ILIKE '%' || $5 || '%')

        UNION ALL

        SELECT created_at::text AS id
        FROM batch_expenses
        WHERE expense_category='utility'
          AND ($1::text IS NULL OR 'operation' = $1)
          AND ($2::text IS NULL OR 'expense' = $2)
          AND ($3::date IS NULL OR created_at >= $3)
          AND ($4::date IS NULL OR created_at <= $4)
          AND ($5::text IS NULL OR 'Factory Utilities' ILIKE '%' || $5 || '%')
      ) AS combined;
    `;
        const countResult = await client.query(countQuery, [
            category,
            type,
            startDate,
            endDate,
            search,
        ]);

        const totalItems = Number(countResult.rows[0].total_count || 0);
        const totalPages = Math.ceil(totalItems / limit);

        return {
            status: true,
            summary,
            data: detailedResult.rows,
            page,
            limit,
            totalItems,
            totalPages,
            monthlyCosts
        };
    } catch (err) {
        console.error(err);
        return { status: false, message: err.message };
    } finally {
        client.release();
    }
};

exports.getMonthlyExpensesReportService = async (params = {}) => {
    const client = await pool.connect();

    try {
        const {
            page = 1,
            limit = 20,
            category: rawCategory = null,
            type: rawType = null,
            startDate = null,
            endDate = null,
            search: rawSearch = null,
            sortBy = 'date',
        } = params;

        // ✅ Convert empty strings to NULL to make SQL filtering work
        const category = rawCategory && rawCategory.trim() !== '' ? rawCategory : null;
        const type = rawType && rawType.trim() !== '' ? rawType : null;
        const search = rawSearch && rawSearch.trim() !== '' ? rawSearch : null;

        const offset = (page - 1) * limit;
        const orderBy = sortBy === 'amount' ? 'amount DESC' : 'date DESC';

        // 🟡 1️⃣ Monthly Summary (for charts)
        const monthlyCostsQuery = `
      SELECT
          TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
          COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS total_material_cost,
          COALESCE(SUM(be.total_cost), 0) AS total_operation_expense,
          COALESCE(SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END), 0) AS utility_expense,
          (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS total_production_cost,
          (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS grand_total_cost,
          MAX(pb.created_at) AS last_updated
      FROM production_batches pb
      LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
      LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
      GROUP BY TO_CHAR(pb.created_at, 'YYYY-MM')
      ORDER BY month ASC;
    `;
        const monthlyCostsResult = await client.query(monthlyCostsQuery);

        const monthlyCosts = monthlyCostsResult.rows.map((row, index, arr) => {
            const current = {
                month: row.month,
                total_material_cost: Number(row.total_material_cost),
                total_operation_expense: Number(row.total_operation_expense),
                utility_expense: Number(row.utility_expense),
                total_production_cost: Number(row.total_production_cost),
                grand_total_cost: Number(row.grand_total_cost),
                last_updated: row.last_updated,
            };

            if (index === 0) {
                return {
                    ...current,
                    change_from_last_month: {
                        total_material_cost: "0",
                        total_operation_expense: "0",
                        utility_expense: "0",
                        total_production_cost: "0",
                        grand_total_cost: "0",
                    },
                };
            }

            const prev = arr[index - 1];
            const calcChange = (cur, prev) => {
                if (prev === 0) return cur === 0 ? 0 : "N/A";
                return parseFloat((((cur - prev) / prev) * 100).toFixed(2));
            };

            return {
                ...current,
                change_from_last_month: {
                    total_material_cost: calcChange(current.total_material_cost, Number(prev.total_material_cost)),
                    total_operation_expense: calcChange(current.total_operation_expense, Number(prev.total_operation_expense)),
                    utility_expense: calcChange(current.utility_expense, Number(prev.utility_expense)),
                    total_production_cost: calcChange(current.total_production_cost, Number(prev.total_production_cost)),
                    grand_total_cost: calcChange(current.grand_total_cost, Number(prev.grand_total_cost)),
                },
            };
        });

        // 🟡 2️⃣ Summary Total Values
        const summaryQuery = `
      SELECT
        COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) AS total_material_cost,
        COALESCE(SUM(be.total_cost),0) AS total_production_cost,
        COALESCE(SUM(oe.amount),0) AS total_operations_cost,
        (COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) +
         COALESCE(SUM(be.total_cost),0) +
         COALESCE(SUM(oe.amount),0)) AS total_expenses
      FROM production_batches pb
      LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
      LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
      LEFT JOIN operation_expenses oe ON pb.id = oe.production_batch_id
      WHERE ($1::date IS NULL OR pb.created_at >= $1)
        AND ($2::date IS NULL OR pb.created_at <= $2);
    `;
        const summaryResult = await client.query(summaryQuery, [startDate, endDate]);
        const summary = summaryResult.rows[0];

        // 🟡 3️⃣ Detailed Data (with filters, pagination & search)
        const detailedQuery = `
      SELECT * FROM (
        -- Material Cost
        SELECT 
          rm.name || ' Purchase' AS title,
          (poi.qty * poi.rate)::numeric AS amount,
          'cost' AS type,
          'material' AS category,
          po.purchase_order_id::text AS ref_no,
          po.order_date AS date
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN raw_materials rm ON rm.id = poi.raw_material_id
        WHERE ($3::text IS NULL OR 'material' = $3)
          AND ($4::text IS NULL OR 'cost' = $4)
          AND ($1::date IS NULL OR po.order_date >= $1)
          AND ($2::date IS NULL OR po.order_date <= $2)
          AND ($7::text IS NULL OR rm.name ILIKE '%' || $7 || '%' OR po.purchase_order_id::text ILIKE '%' || $7 || '%')

        UNION ALL

        -- Production Cost
        SELECT 
          'Production Batch - ' || p.product_name AS title,
          (COALESCE(SUM(brmc.qty_consumed * brmc.rate),0) + COALESCE(SUM(be.total_cost),0))::numeric AS amount,
          'cost' AS type,
          'production' AS category,
          pb.batch_id::text AS ref_no,
          pb.created_at AS date
        FROM production_batches pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
        LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
        WHERE ($3::text IS NULL OR 'production' = $3)
          AND ($4::text IS NULL OR 'cost' = $4)
          AND ($1::date IS NULL OR pb.created_at >= $1)
          AND ($2::date IS NULL OR pb.created_at <= $2)
          AND ($7::text IS NULL OR p.product_name ILIKE '%' || $7 || '%' OR pb.batch_id::text ILIKE '%' || $7 || '%')
        GROUP BY pb.id, p.product_name

        UNION ALL

        -- Operation / Utility Expenses
        SELECT
          'Factory Utilities' AS title,
          SUM(total_cost)::numeric AS amount,
          'expense' AS type,
          'operation' AS category,
          NULL::text AS ref_no,
          created_at AS date
        FROM batch_expenses
        WHERE expense_category='utility'
          AND ($3::text IS NULL OR 'operation' = $3)
          AND ($4::text IS NULL OR 'expense' = $4)
          AND ($1::date IS NULL OR created_at >= $1)
          AND ($2::date IS NULL OR created_at <= $2)
          AND ($7::text IS NULL OR 'Factory Utilities' ILIKE '%' || $7 || '%')
        GROUP BY created_at
      ) AS combined
      ORDER BY ${orderBy}
      LIMIT $5::INTEGER OFFSET $6::INTEGER;
    `;

        const detailedResult = await client.query(detailedQuery, [
            startDate,
            endDate,
            category,
            type,
            limit,
            offset,
            search,
        ]);

        // 🟡 4️⃣ Count Query
        const countQuery = `
      SELECT COUNT(*) AS total_count FROM (
        SELECT po.purchase_order_id::text AS id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN raw_materials rm ON rm.id = poi.raw_material_id
        WHERE ($1::text IS NULL OR 'material' = $1)
          AND ($2::text IS NULL OR 'cost' = $2)
          AND ($3::date IS NULL OR po.order_date >= $3)
          AND ($4::date IS NULL OR po.order_date <= $4)
          AND ($5::text IS NULL OR rm.name ILIKE '%' || $5 || '%' OR po.purchase_order_id::text ILIKE '%' || $5 || '%')

        UNION ALL

        SELECT pb.batch_id::text AS id
        FROM production_batches pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
        LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
        WHERE ($1::text IS NULL OR 'production' = $1)
          AND ($2::text IS NULL OR 'cost' = $2)
          AND ($3::date IS NULL OR pb.created_at >= $3)
          AND ($4::date IS NULL OR pb.created_at <= $4)
          AND ($5::text IS NULL OR p.product_name ILIKE '%' || $5 || '%' OR pb.batch_id::text ILIKE '%' || $5 || '%')

        UNION ALL

        SELECT created_at::text AS id
        FROM batch_expenses
        WHERE expense_category='utility'
          AND ($1::text IS NULL OR 'operation' = $1)
          AND ($2::text IS NULL OR 'expense' = $2)
          AND ($3::date IS NULL OR created_at >= $3)
          AND ($4::date IS NULL OR created_at <= $4)
          AND ($5::text IS NULL OR 'Factory Utilities' ILIKE '%' || $5 || '%')
      ) AS combined;
    `;

        const countResult = await client.query(countQuery, [
            category,
            type,
            startDate,
            endDate,
            search,
        ]);

        const totalItems = Number(countResult.rows[0].total_count || 0);
        const totalPages = Math.ceil(totalItems / limit);

        return {
            status: true,
            summary,
            data: detailedResult.rows,
            page,
            limit,
            totalItems,
            totalPages,
            monthlyCosts,
        };
    } catch (err) {
        console.error('❌ getMonthlyExpensesReportService Error:', err);
        return { status: false, message: err.message };
    } finally {
        client.release();
    }
};






// filter query =(current_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/report
exports.reportAndAnalytics1 = async ({ filter = 'current_month', startDate = null, endDate = null }) => {
    const client = await pool.connect();
    try {
        // 🧭 1️⃣ Define time filters dynamically
        let dateConditionPB = '';
        let dateConditionPO = '';
        let prevDateConditionPB = '';
        let prevDateConditionPO = '';

        if (filter === 'custom' && startDate && endDate) {
            dateConditionPB = `pb.created_at BETWEEN '${startDate}' AND '${endDate}'`;
            dateConditionPO = `po.order_date BETWEEN '${startDate}' AND '${endDate}'`;

            const prevStart = `date '${startDate}' - (date '${endDate}' - date '${startDate}') - interval '1 day'`;
            const prevEnd = `date '${startDate}' - interval '1 day'`;
            prevDateConditionPB = `pb.created_at BETWEEN ${prevStart} AND ${prevEnd}`;
            prevDateConditionPO = `po.order_date BETWEEN ${prevStart} AND ${prevEnd}`;
        } else {
            switch (filter) {
                case 'last_month':
                    dateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now() - interval '1 month')
            AND (date_trunc('month', now()) - interval '1 day')
          `;
                    dateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now() - interval '1 month')
            AND (date_trunc('month', now()) - interval '1 day')
          `;
                    prevDateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now() - interval '2 month')
            AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
          `;
                    prevDateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now() - interval '2 month')
            AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
          `;
                    break;

                case 'last_3_months':
                    dateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now() - interval '3 month')
            AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
          `;
                    dateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now() - interval '3 month')
            AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
          `;
                    prevDateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now() - interval '6 month')
            AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
          `;
                    prevDateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now() - interval '6 month')
            AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
          `;
                    break;

                case 'current_year':
                    dateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now())`;
                    dateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now())`;
                    prevDateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now()) - 1`;
                    prevDateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now()) - 1`;
                    break;

                default: // current_month
                    dateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now())
            AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
          `;
                    dateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now())
            AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
          `;
                    prevDateConditionPB = `
            pb.created_at BETWEEN
            date_trunc('month', now() - interval '1 month')
            AND (date_trunc('month', now()) - interval '1 day')
          `;
                    prevDateConditionPO = `
            po.order_date BETWEEN
            date_trunc('month', now() - interval '1 month')
            AND (date_trunc('month', now()) - interval '1 day')
          `;
            }
        }

        // 🧾 2️⃣ KPI Query (Current & Previous)
        const buildKPIQuery = (pbCond, poCond) => `
      WITH current_production AS (
        SELECT
          COALESCE(SUM(produced_qty), 0) AS total_production,
          COALESCE(SUM(produced_qty) / NULLIF(SUM(planned_qty), 0), 0) AS efficiency
        FROM production_batches pb
        WHERE ${pbCond}
      ),
      current_expenditures AS (
        SELECT SUM(total_cost) AS total_expenditure FROM (
          SELECT brmc.total_cost FROM batch_raw_material_consumptions brmc
          JOIN production_batches pb ON brmc.production_batch_id = pb.id
          WHERE ${pbCond}
          UNION ALL
          SELECT be.total_cost FROM batch_expenses be
          JOIN production_batches pb ON be.production_batch_id = pb.id
          WHERE ${pbCond}
          UNION ALL
          SELECT oe.amount AS total_cost FROM operation_expenses oe
          JOIN production_batches pb ON oe.production_batch_id = pb.id
          WHERE ${pbCond}
        ) all_costs
      ),
      vendor_counts AS (
        SELECT COUNT(DISTINCT vendor_id) AS active_vendors
        FROM purchase_orders po
        WHERE ${poCond}
      )
      SELECT
        (SELECT total_production FROM current_production) AS total_production,
        (SELECT efficiency FROM current_production) AS industrial_efficiency,
        COALESCE((SELECT total_expenditure FROM current_expenditures), 0) AS total_expenditures,
        (SELECT active_vendors FROM vendor_counts) AS active_vendors;
    `;

        const [currentKPI, prevKPI] = await Promise.all([
            client.query(buildKPIQuery(dateConditionPB, dateConditionPO)),
            client.query(buildKPIQuery(prevDateConditionPB, prevDateConditionPO))
        ]);

        const current = currentKPI.rows[0] || {};
        const prev = prevKPI.rows[0] || {};

        // 📊 3️⃣ Percentage Calculation Helper
        const calcPercent = (curr, prev) => {
            if (!prev || prev === 0) return 0;
            return Number((((curr - prev) / prev) * 100).toFixed(2));
        };

        const kpi_percentage = {
            total_production: calcPercent(Number(current.total_production), Number(prev.total_production)),
            industrial_efficiency: calcPercent(Number(current.industrial_efficiency), Number(prev.industrial_efficiency)),
            total_expenditures: calcPercent(Number(current.total_expenditures), Number(prev.total_expenditures)),
            active_vendors: calcPercent(Number(current.active_vendors), Number(prev.active_vendors))
        };

        // 📦 4️⃣ Production Value by Product
        const productValueQuery = `
      SELECT
        p.product_name,
        SUM(
          COALESCE(raw_material_costs.total, 0) +
          COALESCE(batch_expense_costs.total, 0) +
          COALESCE(operation_expense_costs.total, 0)
        ) AS total_production_value
      FROM products p
      JOIN production_batches pb ON p.id = pb.product_id
      LEFT JOIN (
        SELECT production_batch_id, SUM(total_cost) AS total
        FROM batch_raw_material_consumptions
        GROUP BY production_batch_id
      ) raw_material_costs ON pb.id = raw_material_costs.production_batch_id
      LEFT JOIN (
        SELECT production_batch_id, SUM(total_cost) AS total
        FROM batch_expenses
        GROUP BY production_batch_id
      ) batch_expense_costs ON pb.id = batch_expense_costs.production_batch_id
      LEFT JOIN (
        SELECT production_batch_id, SUM(amount) AS total
        FROM operation_expenses
        GROUP BY production_batch_id
      ) operation_expense_costs ON pb.id = operation_expense_costs.production_batch_id
      WHERE ${dateConditionPB}
      GROUP BY p.product_name
      ORDER BY total_production_value DESC;
    `;
        const productValueResult = await client.query(productValueQuery);

        // 💰 5️⃣ Expenditure Breakdown
        const expenditureBreakdownQuery = `
      SELECT 'Raw Materials' AS category, COALESCE(SUM(brmc.total_cost), 0) AS total_amount
      FROM batch_raw_material_consumptions brmc
      JOIN production_batches pb ON brmc.production_batch_id = pb.id
      WHERE ${dateConditionPB}

      UNION ALL

      SELECT 'Production Costs' AS category, COALESCE(SUM(be.total_cost), 0) AS total_amount
      FROM batch_expenses be
      JOIN production_batches pb ON be.production_batch_id = pb.id
      WHERE ${dateConditionPB}

      UNION ALL

      SELECT 'Operations' AS category, COALESCE(SUM(oe.amount), 0) AS total_amount
      FROM operation_expenses oe
      JOIN production_batches pb ON oe.production_batch_id = pb.id
      WHERE ${dateConditionPB}

      UNION ALL

      SELECT 'Procurement' AS category, COALESCE(SUM(total_amount), 0) AS total_amount
      FROM purchase_orders po
      WHERE ${dateConditionPO};
    `;
        const expenditureResult = await client.query(expenditureBreakdownQuery);

        // ✅ 6️⃣ Final Response
        return {
            status: true,
            message: `Report and analytics fetched successfully for filter: ${filter}`,
            data: {
                kpis: {
                    ...current,
                    kpi_percentage
                },
                productValues: productValueResult.rows,
                expenditureBreakdown: expenditureResult.rows
            }
        };

    } catch (error) {
        console.error('Error in reportAndAnalytics:', error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.reportAndAnalytics2 = async ({ filter = 'current_month', startDate = null, endDate = null }) => {
    const client = await pool.connect();
    try {
        // 🧭 1️⃣ Define time filters dynamically
        let dateConditionPB = '';
        let dateConditionPO = '';
        let prevDateConditionPB = '';
        let prevDateConditionPO = '';

        if (filter === 'custom' && startDate && endDate) {
            dateConditionPB = `pb.created_at BETWEEN '${startDate}' AND '${endDate}' AND b.status = 'completed'`;
            dateConditionPO = `po.order_date BETWEEN '${startDate}' AND '${endDate}'`;

            const prevStart = `date '${startDate}' - (date '${endDate}' - date '${startDate}') - interval '1 day'`;
            const prevEnd = `date '${startDate}' - interval '1 day'`;
            prevDateConditionPB = `pb.created_at BETWEEN ${prevStart} AND ${prevEnd} AND b.status = 'completed'`;
            prevDateConditionPO = `po.order_date BETWEEN ${prevStart} AND ${prevEnd}`;
        } else {
            switch (filter) {
                case 'last_month':
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '2 month')
                        AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '2 month')
                        AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
                    `;
                    break;

                case 'last_3_months':
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '3 month')
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '3 month')
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '6 month')
                        AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '6 month')
                        AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
                    `;
                    break;

                case 'current_year':
                    dateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now()) AND b.status = 'completed'`;
                    dateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now())`;
                    prevDateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now()) - 1 AND b.status = 'completed'`;
                    prevDateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now()) - 1`;
                    break;

                default: // current_month
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now())
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now())
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                        AND b.status = 'completed'
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
            }
        }

        // 🧾 2️⃣ KPI Query (Current & Previous)
        const buildKPIQuery = (pbCond, poCond) => `
            WITH current_production AS (
                SELECT
                    COALESCE(SUM(pb.produced_qty), 0) AS total_production,
                    COALESCE(SUM(pb.produced_qty) / NULLIF(SUM(pb.planned_qty), 0), 0) AS efficiency
                FROM production_batches pb
                JOIN batches b ON pb.batch_id = b.id
                WHERE ${pbCond}
            ),
            current_expenditures AS (
                SELECT SUM(total_cost) AS total_expenditure FROM (
                    SELECT brmc.total_cost FROM batch_raw_material_consumptions brmc
                    JOIN production_batches pb ON brmc.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond}
                    UNION ALL
                    SELECT be.total_cost FROM batch_expenses be
                    JOIN production_batches pb ON be.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond}
                    UNION ALL
                    SELECT oe.amount AS total_cost FROM operation_expenses oe
                    JOIN production_batches pb ON oe.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond}
                ) all_costs
            ),
            vendor_counts AS (
                SELECT COUNT(DISTINCT vendor_id) AS active_vendors
                FROM purchase_orders po
                WHERE ${poCond}
            )
            SELECT
                (SELECT total_production FROM current_production) AS total_production,
                (SELECT efficiency FROM current_production) AS industrial_efficiency,
                COALESCE((SELECT total_expenditure FROM current_expenditures), 0) AS total_expenditures,
                (SELECT active_vendors FROM vendor_counts) AS active_vendors;
        `;

        const [currentKPI, prevKPI] = await Promise.all([
            client.query(buildKPIQuery(dateConditionPB, dateConditionPO)),
            client.query(buildKPIQuery(prevDateConditionPB, prevDateConditionPO))
        ]);

        const current = currentKPI.rows[0] || {};
        const prev = prevKPI.rows[0] || {};

        const calcPercent = (curr, prev) => (!prev || prev === 0 ? 0 : Number((((curr - prev) / prev) * 100).toFixed(2)));

        const kpi_percentage = {
            total_production: calcPercent(Number(current.total_production), Number(prev.total_production)),
            industrial_efficiency: calcPercent(Number(current.industrial_efficiency), Number(prev.industrial_efficiency)),
            total_expenditures: calcPercent(Number(current.total_expenditures), Number(prev.total_expenditures)),
            active_vendors: calcPercent(Number(current.active_vendors), Number(prev.active_vendors))
        };

        // 📦 3️⃣ Production Value by Product
        const productValueQuery = `
            SELECT
                p.product_name,
                SUM(
                    COALESCE(raw_material_costs.total, 0) +
                    COALESCE(batch_expense_costs.total, 0) +
                    COALESCE(operation_expense_costs.total, 0)
                ) AS total_production_value
            FROM products p
            JOIN production_batches pb ON p.id = pb.product_id
            JOIN batches b ON pb.batch_id = b.id
            LEFT JOIN (
                SELECT production_batch_id, SUM(total_cost) AS total
                FROM batch_raw_material_consumptions
                GROUP BY production_batch_id
            ) raw_material_costs ON pb.id = raw_material_costs.production_batch_id
            LEFT JOIN (
                SELECT production_batch_id, SUM(total_cost) AS total
                FROM batch_expenses
                GROUP BY production_batch_id
            ) batch_expense_costs ON pb.id = batch_expense_costs.production_batch_id
            LEFT JOIN (
                SELECT production_batch_id, SUM(amount) AS total
                FROM operation_expenses
                GROUP BY production_batch_id
            ) operation_expense_costs ON pb.id = operation_expense_costs.production_batch_id
            WHERE ${dateConditionPB}
            GROUP BY p.product_name
            ORDER BY total_production_value DESC;
        `;
        const productValueResult = await client.query(productValueQuery);

        // 💰 4️⃣ Expenditure Breakdown
        const expenditureBreakdownQuery = `
            SELECT 'Raw Materials' AS category, COALESCE(SUM(brmc.total_cost), 0) AS total_amount
            FROM batch_raw_material_consumptions brmc
            JOIN production_batches pb ON brmc.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB}

            UNION ALL

            SELECT 'Production Costs' AS category, COALESCE(SUM(be.total_cost), 0) AS total_amount
            FROM batch_expenses be
            JOIN production_batches pb ON be.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB}

            UNION ALL

            SELECT 'Operations' AS category, COALESCE(SUM(oe.amount), 0) AS total_amount
            FROM operation_expenses oe
            JOIN production_batches pb ON oe.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB}

            UNION ALL

            SELECT 'Procurement' AS category, COALESCE(SUM(total_amount), 0) AS total_amount
            FROM purchase_orders po
            WHERE ${dateConditionPO};
        `;
        const expenditureResult = await client.query(expenditureBreakdownQuery);

        // ✅ 5️⃣ Final Response
        return {
            status: true,
            message: `Report and analytics fetched successfully for filter: ${filter}`,
            data: {
                kpis: { ...current, kpi_percentage },
                productValues: productValueResult.rows,
                expenditureBreakdown: expenditureResult.rows
            }
        };

    } catch (error) {
        console.error('Error in reportAndAnalytics:', error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.reportAndAnalytics = async ({ filter = 'current_month', startDate = null, endDate = null }) => {
    const client = await pool.connect();
    try {
        // 🧭 1️⃣ Define time filters dynamically
        let dateConditionPB = '';
        let dateConditionPO = '';
        let prevDateConditionPB = '';
        let prevDateConditionPO = '';

        if (filter === 'custom' && startDate && endDate) {
            dateConditionPB = `pb.created_at BETWEEN '${startDate}' AND '${endDate}'`;
            dateConditionPO = `po.order_date BETWEEN '${startDate}' AND '${endDate}'`;

            const prevStart = `date '${startDate}' - (date '${endDate}' - date '${startDate}') - interval '1 day'`;
            const prevEnd = `date '${startDate}' - interval '1 day'`;
            prevDateConditionPB = `pb.created_at BETWEEN ${prevStart} AND ${prevEnd}`;
            prevDateConditionPO = `po.order_date BETWEEN ${prevStart} AND ${prevEnd}`;
        } else {
            switch (filter) {
                case 'last_month':
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '2 month')
                        AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '2 month')
                        AND (date_trunc('month', now() - interval '1 month') - interval '1 day')
                    `;
                    break;

                case 'last_3_months':
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '3 month')
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '3 month')
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '6 month')
                        AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '6 month')
                        AND (date_trunc('month', now() - interval '3 month') - interval '1 day')
                    `;
                    break;

                case 'current_year':
                    dateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now())`;
                    dateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now())`;
                    prevDateConditionPB = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM now()) - 1`;
                    prevDateConditionPO = `EXTRACT(YEAR FROM po.order_date) = EXTRACT(YEAR FROM now()) - 1`;
                    break;

                default: // current_month
                    dateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now())
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    dateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now())
                        AND (date_trunc('month', now()) + interval '1 month' - interval '1 day')
                    `;
                    prevDateConditionPB = `
                        pb.created_at BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
                    prevDateConditionPO = `
                        po.order_date BETWEEN
                        date_trunc('month', now() - interval '1 month')
                        AND (date_trunc('month', now()) - interval '1 day')
                    `;
            }
        }

        // 🧾 2️⃣ KPI Query (Current & Previous)
        const buildKPIQuery = (pbCond, poCond) => `
            WITH current_production AS (
                SELECT
                    COALESCE(SUM(pb.produced_qty), 0) AS total_production,
                    COALESCE(SUM(pb.produced_qty) / NULLIF(SUM(pb.planned_qty), 0), 0) AS efficiency
                FROM production_batches pb
                JOIN batches b ON pb.batch_id = b.id
                WHERE ${pbCond} AND b.status != 'rejected'
            ),
            current_expenditures AS (
                SELECT SUM(total_cost) AS total_expenditure FROM (
                    SELECT brmc.total_cost FROM batch_raw_material_consumptions brmc
                    JOIN production_batches pb ON brmc.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond} AND b.status != 'rejected'
                    UNION ALL
                    SELECT be.total_cost FROM batch_expenses be
                    JOIN production_batches pb ON be.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond} AND b.status != 'rejected'
                    UNION ALL
                    SELECT oe.amount AS total_cost FROM operation_expenses oe
                    JOIN production_batches pb ON oe.production_batch_id = pb.id
                    JOIN batches b ON pb.batch_id = b.id
                    WHERE ${pbCond} AND b.status != 'rejected'
                ) all_costs
            ),
            vendor_counts AS (
                SELECT COUNT(DISTINCT vendor_id) AS active_vendors
                FROM purchase_orders po
                WHERE ${poCond}
            )
            SELECT
                (SELECT total_production FROM current_production) AS total_production,
                (SELECT efficiency FROM current_production) AS industrial_efficiency,
                COALESCE((SELECT total_expenditure FROM current_expenditures), 0) AS total_expenditures,
                (SELECT active_vendors FROM vendor_counts) AS active_vendors;
        `;

        const [currentKPI, prevKPI] = await Promise.all([
            client.query(buildKPIQuery(dateConditionPB, dateConditionPO)),
            client.query(buildKPIQuery(prevDateConditionPB, prevDateConditionPO))
        ]);

        const total_production_qty = await client.query(`SELECT COUNT(*) AS total_production
FROM production_batches pb
JOIN batches b ON pb.batch_id = b.id
WHERE b.status != 'rejected'`)
        const current = currentKPI.rows[0] || {};
        const prev = prevKPI.rows[0] || {};

        const calcPercent = (curr, prev) => (!prev || prev === 0 ? 0 : Number((((curr - prev) / prev) * 100).toFixed(2)));

        const kpi_percentage = {
            total_production: calcPercent(Number(current.total_production), Number(prev.total_production)),
            industrial_efficiency: calcPercent(Number(current.industrial_efficiency), Number(prev.industrial_efficiency)),
            total_expenditures: calcPercent(Number(current.total_expenditures), Number(prev.total_expenditures)),
            active_vendors: calcPercent(Number(current.active_vendors), Number(prev.active_vendors))
        };

        // 📦 3️⃣ Production Value by Product
        const productValueQuery = `
            SELECT
                p.product_name,
                SUM(
                    COALESCE(raw_material_costs.total, 0) +
                    COALESCE(batch_expense_costs.total, 0) +
                    COALESCE(operation_expense_costs.total, 0)
                ) AS total_production_value
            FROM products p
            JOIN production_batches pb ON p.id = pb.product_id
            JOIN batches b ON pb.batch_id = b.id
            LEFT JOIN (
                SELECT production_batch_id, SUM(total_cost) AS total
                FROM batch_raw_material_consumptions
                GROUP BY production_batch_id
            ) raw_material_costs ON pb.id = raw_material_costs.production_batch_id
            LEFT JOIN (
                SELECT production_batch_id, SUM(total_cost) AS total
                FROM batch_expenses
                GROUP BY production_batch_id
            ) batch_expense_costs ON pb.id = batch_expense_costs.production_batch_id
            LEFT JOIN (
                SELECT production_batch_id, SUM(amount) AS total
                FROM operation_expenses
                GROUP BY production_batch_id
            ) operation_expense_costs ON pb.id = operation_expense_costs.production_batch_id
            WHERE ${dateConditionPB} AND b.status != 'rejected'
            GROUP BY p.product_name
            ORDER BY total_production_value DESC;
        `;
        const productValueResult = await client.query(productValueQuery);

        // 💰 4️⃣ Expenditure Breakdown
        const expenditureBreakdownQuery = `
            SELECT 'Raw Materials' AS category, COALESCE(SUM(brmc.total_cost), 0) AS total_amount
            FROM batch_raw_material_consumptions brmc
            JOIN production_batches pb ON brmc.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB} AND b.status != 'rejected'

            UNION ALL

            SELECT 'Production Costs' AS category, COALESCE(SUM(be.total_cost), 0) AS total_amount
            FROM batch_expenses be
            JOIN production_batches pb ON be.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB} AND b.status != 'rejected'

            UNION ALL

            SELECT 'Operations' AS category, COALESCE(SUM(oe.amount), 0) AS total_amount
            FROM operation_expenses oe
            JOIN production_batches pb ON oe.production_batch_id = pb.id
            JOIN batches b ON pb.batch_id = b.id
            WHERE ${dateConditionPB} AND b.status != 'rejected'

            UNION ALL

            SELECT 'Procurement' AS category, COALESCE(SUM(total_amount), 0) AS total_amount
            FROM purchase_orders po
            WHERE ${dateConditionPO};
        `;
        const expenditureResult = await client.query(expenditureBreakdownQuery);

        // ✅ 5️⃣ Final Response
        current.total_production = total_production_qty.rows[0].total_production
        return {
            status: true,
            message: `Report and analytics fetched successfully for filter: ${filter}`,
            data: {
                kpis: { ...current, kpi_percentage },
                productValues: productValueResult.rows,
                expenditureBreakdown: expenditureResult.rows
            }
        };

    } catch (error) {
        console.error('Error in reportAndAnalytics:', error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

// expenditure.services.js
// filter query =(current_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
exports.getMonthlyProductionReportService = async (params = {}) => {
    const client = await pool.connect();
    try {
        // Use defaults if params undefined
        const {
            filter = 'current_month',
            startDate,
            endDate,
            format = 'json',
            category = 'all',
            sortBy = 'month',
            sortOrder = 'asc'
        } = params || {};

        let dateCondition = '';
        if (startDate && endDate) {
            const fromDate = new Date(startDate); fromDate.setHours(0, 0, 0, 0);
            const toDate = new Date(endDate); toDate.setHours(23, 59, 59, 999);
            dateCondition = `pb.created_at >= '${fromDate.toISOString()}' AND pb.created_at <= '${toDate.toISOString()}'`;
        } else {
            switch (filter) {
                case 'last_month':
                    dateCondition = `pb.created_at >= date_trunc('month', CURRENT_DATE - interval '1 month')
                                     AND pb.created_at < date_trunc('month', CURRENT_DATE)`;
                    break;
                case 'last_3_months':
                    dateCondition = `pb.created_at >= CURRENT_DATE - interval '3 months'`;
                    break;
                case 'current_year':
                    dateCondition = `EXTRACT(YEAR FROM pb.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`;
                    break;
                case 'current_month':
                default:
                    dateCondition = `pb.created_at >= date_trunc('month', CURRENT_DATE)`;
            }
        }

        let categoryFilter = '';
        if (category && category !== 'all') categoryFilter = `AND be.expense_category = '${category}'`;

        const query = `
            SELECT
                b.batch_no,
                TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS material_cost,
                COALESCE(SUM(be.total_cost), 0) AS operation_expense,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.total_cost), 0)) AS total_production_cost,
                pb.created_at AS production_date
            FROM production_batches pb
            JOIN batches b ON pb.batch_id = b.id
            LEFT JOIN batch_raw_material_consumptions brmc ON pb.id = brmc.production_batch_id
            LEFT JOIN batch_expenses be ON pb.id = be.production_batch_id
            WHERE b.status = 'completed'
            ${dateCondition ? `AND ${dateCondition}` : ''}
            ${categoryFilter}
            GROUP BY b.batch_no, pb.created_at
            ORDER BY ${sortBy} ${sortOrder};
        `;

        const { rows } = await client.query(query);

        const headers = ["Batch No", "Month", "Production Date", "Material Cost", "Operational Expense", "Total Production Cost"];
        const dataRows = rows.map(row => ({
            BatchNo: row.batch_no,
            Month: row.month,
            ProductionDate: row.production_date,
            MaterialCost: Number(row.material_cost),
            OperationalExpense: Number(row.operation_expense),
            TotalProductionCost: Number(row.total_production_cost)
        }));

        if (format === 'csv') {
            const csvData = rows.map(row => ({
                "Batch No": row.batch_no,
                "Month": row.month,
                "Production Date": row.production_date,
                "Material Cost": Number(row.material_cost),
                "Operational Expense": Number(row.operation_expense),
                "Total Production Cost": Number(row.total_production_cost)
            }));
            return { status: true, format: 'csv', headers, csvData };
        }

        return { status: true, format: 'json', headers, rows: dataRows };

    } catch (error) {
        console.error(error);
        return { status: false, message: error.message };
    } finally {
        client.release();
    }
};



// sorting params =(current_month,last_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/financial-report
exports.generateFinancialReportService = async (params = {}) => {
    const client = await pool.connect();
    try {
        const {
            filter = 'current_month',
            startDate,
            endDate,
            productId,
            batchNo,
            expenseCategory,
            format = 'json'
        } = params;

        // 🔹 Date range calculation
        let fromDate = null;
        let toDate = null;

        if (startDate && endDate) {
            // custom date filter
            const startParts = startDate.includes('-') ? startDate.split('-') : null;
            const endParts = endDate.includes('-') ? endDate.split('-') : null;

            // Convert DD-MM-YYYY → YYYY-MM-DD if needed
            const parseDate = (parts) =>
                parts.length === 3 && parts[0].length === 2
                    ? `${parts[2]}-${parts[1]}-${parts[0]}`
                    : parts.join('-');

            fromDate = new Date(parseDate(startParts));
            fromDate.setHours(0, 0, 0, 0);

            toDate = new Date(parseDate(endParts));
            toDate.setHours(23, 59, 59, 999);
        } else {
            const now = new Date();
            toDate = new Date();
            toDate.setHours(23, 59, 59, 999);

            switch (filter) {
                case 'last_month': {
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                }
                case 'last_3_months': {
                    fromDate = new Date(now);
                    fromDate.setMonth(fromDate.getMonth() - 3);
                    break;
                }
                case 'current_year': {
                    fromDate = new Date(now.getFullYear(), 0, 1);
                    break;
                }
                case 'current_month':
                default: {
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                }
            }
        }

        // 🔹 Build dynamic SQL filters
        let dateCondition = '';
        if (fromDate) dateCondition += ` AND b.start_date >= '${fromDate.toISOString()}'`;
        if (toDate) dateCondition += ` AND b.start_date <= '${toDate.toISOString()}'`;

        const productFilter = productId ? ` AND p.id = '${productId}'` : '';
        const batchFilter = batchNo ? ` AND b.batch_no = '${batchNo}'` : '';
        const categoryFilter = expenseCategory ? ` AND be.expense_category = '${expenseCategory}'` : '';

        // 🔹 Query
        const productionCostsQuery = `
            SELECT
                pb.id AS production_batch_id,
                b.batch_no,
                p.product_name,
                pb.planned_qty,
                pb.produced_qty,
                COALESCE(SUM(brmc.total_cost), 0) AS material_cost,
                COALESCE(SUM(oe.amount), 0) AS operation_expense,
                COALESCE(SUM(be.total_cost), 0) AS other_expenses,
                (COALESCE(SUM(brmc.total_cost), 0) +
                 COALESCE(SUM(oe.amount), 0) +
                 COALESCE(SUM(be.total_cost), 0)) AS total_production_cost,
                b.start_date
            FROM production_batches pb
            LEFT JOIN batches b ON pb.batch_id = b.id
            LEFT JOIN products p ON pb.product_id = p.id
            LEFT JOIN batch_raw_material_consumptions brmc ON brmc.production_batch_id = pb.id
            LEFT JOIN operation_expenses oe ON oe.production_batch_id = pb.id
            LEFT JOIN batch_expenses be ON be.production_batch_id = pb.id
            WHERE 1=1
            ${dateCondition}
            ${productFilter}
            ${batchFilter}
            ${categoryFilter}
            GROUP BY pb.id, b.batch_no, b.start_date, p.product_name, pb.planned_qty, pb.produced_qty
            ORDER BY b.start_date ASC
        `;

        const productionCosts = await client.query(productionCostsQuery);

        // 🔹 Transform data for report
        const detailedReport = productionCosts.rows.map(row => {
            const budgetedCost = row.produced_qty > 0
                ? row.planned_qty * (row.material_cost / row.produced_qty)
                : 0;
            const variance = row.total_production_cost - budgetedCost;
            return {
                Batch_No: row.batch_no,
                Product_Name: row.product_name,
                Planned_Qty: Number(row.planned_qty),
                Produced_Qty: Number(row.produced_qty),
                Material_Cost: Number(row.material_cost).toFixed(2),
                Operation_Expense: Number(row.operation_expense).toFixed(2),
                Other_Expenses: Number(row.other_expenses).toFixed(2),
                Total_Production_Cost: Number(row.total_production_cost).toFixed(2),
                Budgeted_Cost: Number(budgetedCost).toFixed(2),
                Variance: Number(variance).toFixed(2),
                Start_Date: row.start_date
            };
        });

        const headers = [
            'Batch_No',
            'Product_Name',
            'Planned_Qty',
            'Produced_Qty',
            'Material_Cost',
            'Operation_Expense',
            'Other_Expenses',
            'Total_Production_Cost',
            'Budgeted_Cost',
            'Variance',
            'Start_Date'
        ];

        // 🔹 CSV output
        if (format === 'csv') {
            const fields = headers.map(h => ({ label: h.replace(/_/g, ' '), value: h }));
            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(detailedReport);
            return { status: true, format: 'csv', csv, filename: 'financial_report.csv' };
        }

        // 🔹 JSON output
        return { status: true, format: 'json', headers, data: detailedReport };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};


// Suggested function name: generateInventoryReport
// sorting params =(current_month,last_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/inventory-report
exports.generateInventoryReportService = async (params = {}) => {
    const client = await pool.connect();
    try {
        const { filter = 'current_month', startDate, endDate, format = 'json' } = params;

        // 🔹 1️⃣ Calculate date range
        let fromDate = null, toDate = null;
        const now = new Date();

        if (startDate && endDate) {
            const parseDate = (d) => {
                const [day, month, year] = d.split('-');
                return new Date(`${year}-${month}-${day}`);
            };
            fromDate = parseDate(startDate); fromDate.setHours(0, 0, 0, 0);
            toDate = parseDate(endDate); toDate.setHours(23, 59, 59, 999);
        } else {
            switch (filter) {
                case 'last_month':
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'last_3_months':
                    fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3);
                    toDate = now;
                    break;
                case 'current_year':
                    fromDate = new Date(now.getFullYear(), 0, 1);
                    toDate = now;
                    break;
                case 'current_month':
                default:
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    toDate = now;
            }
        }

        const dateCondition = fromDate && toDate
            ? ` AND pb.created_at >= '${fromDate.toISOString()}' AND pb.created_at <= '${toDate.toISOString()}'`
            : '';

        // 🔹 2️⃣ Current stock levels
        const stockQuery = `
            SELECT id, code, name, uom, category, total_qty, reorder_level
            FROM raw_materials
            ORDER BY name;
        `;
        const { rows: stockLevels } = await client.query(stockQuery);

        // 🔹 3️⃣ Total consumption per raw material
        const consumptionQuery = `
            SELECT
                brmc.raw_material_id,
                rm.name,
                SUM(brmc.qty_consumed) AS total_consumed
            FROM batch_raw_material_consumptions brmc
            JOIN production_batches pb ON pb.id = brmc.production_batch_id
            JOIN raw_materials rm ON rm.id = brmc.raw_material_id
            WHERE 1=1
            ${dateCondition}
            GROUP BY brmc.raw_material_id, rm.name
            ORDER BY rm.name;
        `;
        const { rows: materialConsumption } = await client.query(consumptionQuery);

        // 🔹 4️⃣ Reorder recommendations
        const reorderRecommendations = stockLevels.map(item => {
            const consumption = materialConsumption.find(c => c.raw_material_id === item.id);
            const totalConsumed = consumption ? parseFloat(consumption.total_consumed) : 0;
            return {
                Raw_Material_ID: item.id,
                Name: item.name,
                Current_Stock: parseFloat(item.total_qty),
                Reorder_Level: parseFloat(item.reorder_level),
                Total_Consumed: totalConsumed,
                Needs_Reorder: parseFloat(item.total_qty) < parseFloat(item.reorder_level)
            };
        });

        // 🔹 5️⃣ CSV support
        if (format === 'csv') {
            console.log("<><>woring")
            const fields = [
                { label: 'Raw Material ID', value: 'Raw_Material_ID' },
                { label: 'Name', value: 'Name' },
                { label: 'Current Stock', value: 'Current_Stock' },
                { label: 'Reorder Level', value: 'Reorder_Level' },
                { label: 'Total Consumed', value: 'Total_Consumed' },
                { label: 'Needs Reorder', value: 'Needs_Reorder' }
            ];
            const parser = new Parser({ fields });
            const csv = parser.parse(reorderRecommendations);
            return { status: true, format: 'csv', csv, filename: 'inventory_report.csv' };
        }
        const headers = ['Raw_Material_ID', 'Name', 'Current_Stock', 'Reorder_Level', 'Total_Consumed', 'Needs_Reorder'];

        // 🔹 6️⃣ JSON support
        return { status: true, format: 'json', headers, data: reorderRecommendations };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

// Suggested function name: generateInventoryReport
// sorting params =(current_month,last_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/vendor-report
// Suggested function name: generateVendorPerformanceReport
exports.generateVendorPerformanceReport1 = async (params = {}) => {
    const client = await pool.connect();
    try {
        const { filter = 'current_month', startDate, endDate, format = 'json' } = params;

        let fromDate = null, toDate = null;
        const now = new Date();

        if (startDate && endDate) {
            const parseDate = (d) => {
                const [day, month, year] = d.split('-');
                return new Date(`${year}-${month}-${day}`);
            };
            fromDate = parseDate(startDate); fromDate.setHours(0, 0, 0, 0);
            toDate = parseDate(endDate); toDate.setHours(23, 59, 59, 999);
        } else {
            switch (filter) {
                case 'last_month':
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'last_3_months':
                    fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3);
                    toDate = now;
                    break;
                case 'current_year':
                    fromDate = new Date(now.getFullYear(), 0, 1);
                    toDate = now;
                    break;
                case 'current_month':
                default:
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    toDate = now;
            }
        }

        const dateCondition = fromDate && toDate
            ? ` AND po.order_date >= '${fromDate.toISOString()}' AND po.order_date <= '${toDate.toISOString()}'`
            : '';

        // Fetch vendors + purchase orders
        const query = `
            SELECT
                v.id AS vendor_id,
                v.name AS vendor_name,
                v.contact_email,
                v.phone,
                COUNT(po.id) AS total_orders,
                COALESCE(SUM(po.total_amount),0) AS total_spent,
                COALESCE(AVG(EXTRACT(EPOCH FROM (gr.received_at - po.order_date))/86400),0) AS avg_delivery_days,
                SUM(CASE WHEN po.status NOT IN ('received','shipped') THEN 1 ELSE 0 END) AS pending_orders
            FROM vendors v
            LEFT JOIN purchase_orders po 
                ON po.vendor_id = v.id
                ${dateCondition ? `AND po.order_date >= '${fromDate.toISOString()}' AND po.order_date <= '${toDate.toISOString()}'` : ''}
            LEFT JOIN grns gr ON gr.purchase_order_id = po.id
            GROUP BY v.id, v.name, v.contact_email, v.phone
            ORDER BY v.name;
        `;


        const { rows } = await client.query(query);

        // Transform
        const reportData = rows.map(row => ({
            VendorID: row.vendor_id,
            VendorName: row.vendor_name,
            ContactEmail: row.contact_email,
            Phone: row.phone,
            TotalOrders: parseInt(row.total_orders),
            TotalSpent: parseFloat(row.total_spent).toFixed(2),
            AvgDeliveryDays: parseFloat(row.avg_delivery_days).toFixed(2),
            PendingOrders: parseInt(row.pending_orders)
        }));

        // CSV support
        if (format === 'csv') {
            const fields = [
                { label: 'Vendor ID', value: 'VendorID' },
                { label: 'Vendor Name', value: 'VendorName' },
                { label: 'Contact Email', value: 'ContactEmail' },
                { label: 'Phone', value: 'Phone' },
                { label: 'Total Orders', value: 'TotalOrders' },
                { label: 'Total Spent', value: 'TotalSpent' },
                { label: 'Average Delivery Days', value: 'AvgDeliveryDays' },
                { label: 'Pending Orders', value: 'PendingOrders' }
            ];
            const parser = new Parser({ fields });
            const csv = parser.parse(reportData);
            return { status: true, format: 'csv', csv, filename: 'vendor_performance_report.csv' };
        }

        // JSON output with headers
        const headers = ['VendorID', 'VendorName', 'ContactEmail', 'Phone', 'TotalOrders', 'TotalSpent', 'AvgDeliveryDays', 'PendingOrders'];
        return { status: true, format: 'json', headers, data: reportData };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.generateVendorPerformanceReport = async (params = {}) => {
    const client = await pool.connect();
    try {
        const { filter = 'current_month', startDate, endDate, format = 'json' } = params;

        let fromDate = null, toDate = null;
        const now = new Date();

        if (startDate && endDate) {
            const parseDate = (d) => {
                const [day, month, year] = d.split('-');
                return new Date(`${year}-${month}-${day}`);
            };
            fromDate = parseDate(startDate); fromDate.setHours(0, 0, 0, 0);
            toDate = parseDate(endDate); toDate.setHours(23, 59, 59, 999);
        } else {
            switch (filter) {
                case 'last_month':
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'last_3_months':
                    fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3);
                    toDate = now;
                    break;
                case 'current_year':
                    fromDate = new Date(now.getFullYear(), 0, 1);
                    toDate = now;
                    break;
                case 'current_month':
                default:
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    toDate = now;
            }
        }

        const fromDateStr = fromDate.toISOString();
        const toDateStr = toDate.toISOString();


        const query = `SELECT
    v.id AS vendor_id,
    v.name AS vendor_name,
    v.contact_email,
    v.phone,
    COUNT(po.id) AS total_orders,
    COALESCE(SUM(po.total_amount::numeric), 0) AS total_spent,
    SUM(CASE WHEN po.status NOT IN ('received','shipped') THEN 1 ELSE 0 END) AS pending_orders
FROM vendors v
LEFT JOIN purchase_orders po
    ON po.vendor_id = v.id
    AND po.order_date >= '2025-10-01T00:00:00.000Z' -- example start date
    AND po.order_date <= '2025-10-31T23:59:59.999Z' -- example end date
GROUP BY v.id, v.name, v.contact_email, v.phone
ORDER BY v.name`

        const { rows } = await client.query(query);

        const reportData = rows.map(row => ({
            VendorID: row.vendor_id,
            VendorName: row.vendor_name,
            ContactEmail: row.contact_email,
            Phone: row.phone,
            TotalOrders: parseInt(row.total_orders),
            TotalSpent: parseFloat(row.total_spent).toFixed(2),
            PendingOrders: parseInt(row.pending_orders)
        }));

        if (format === 'csv') {
            const fields = [
                { label: 'Vendor ID', value: 'VendorID' },
                { label: 'Vendor Name', value: 'VendorName' },
                { label: 'Contact Email', value: 'ContactEmail' },
                { label: 'Phone', value: 'Phone' },
                { label: 'Total Orders', value: 'TotalOrders' },
                { label: 'Total Spent', value: 'TotalSpent' },
                { label: 'Pending Orders', value: 'PendingOrders' }
            ];
            const parser = new Parser({ fields });
            const csv = parser.parse(reportData);
            return { status: true, format: 'csv', csv, filename: 'vendor_performance_report.csv' };
        }

        const headers = ['VendorID', 'VendorName', 'ContactEmail', 'Phone', 'TotalOrders', 'TotalSpent', 'PendingOrders'];
        return { status: true, format: 'json', headers, data: reportData };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};





// sorting params =(current_month,last_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/quality-control-report
// Suggested function name: generateQualityControlReport
// Suggested function name: generateQualityControlReport

exports.generateQualityControlReport = async (params = {}) => {
    const client = await pool.connect();
    try {
        const { filter = 'current_month', startDate, endDate, format = 'json' } = params;

        let fromDate = null, toDate = null;
        const now = new Date();

        if (startDate && endDate) {
            const parseDate = (d) => {
                const [day, month, year] = d.split('-');
                return new Date(`${year}-${month}-${day}`);
            };
            fromDate = parseDate(startDate); fromDate.setHours(0, 0, 0, 0);
            toDate = parseDate(endDate); toDate.setHours(23, 59, 59, 999);
        } else {
            switch (filter) {
                case 'last_month':
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'last_3_months':
                    fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3); toDate = now;
                    break;
                case 'current_year':
                    fromDate = new Date(now.getFullYear(), 0, 1); toDate = now;
                    break;
                case 'current_month':
                default:
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1); toDate = now;
            }
        }

        const dateCondition = fromDate && toDate
            ? `AND b.start_date >= '${fromDate.toISOString()}' AND b.start_date <= '${toDate.toISOString()}'`
            : '';

        const query = `
            SELECT
                b.id AS batch_id,
                b.batch_no,
                p.product_name,
                b.status AS batch_status,
                COUNT(pb.id) AS total_production_batches,
                SUM(CASE WHEN b.status = 'QC' THEN 1 ELSE 0 END) AS qc_pending_batches,
                SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed_batches,
                SUM(CASE WHEN b.status = 'QC' AND pb.produced_qty = 0 THEN 1 ELSE 0 END) AS rejected_batches
            FROM batches b
            LEFT JOIN production_batches pb ON pb.batch_id = b.id
            LEFT JOIN products p ON p.id = b.product_id
            WHERE 1=1 ${dateCondition}
            GROUP BY b.id, b.batch_no, p.product_name, b.status
            ORDER BY b.start_date DESC;
        `;

        const { rows } = await client.query(query);

        const reportData = rows.map(r => ({
            BatchID: r.batch_id,
            BatchNo: r.batch_no,
            ProductName: r.product_name,
            BatchStatus: r.batch_status,
            TotalProductionBatches: parseInt(r.total_production_batches),
            QCPendingBatches: parseInt(r.qc_pending_batches),
            CompletedBatches: parseInt(r.completed_batches),
            RejectedBatches: parseInt(r.rejected_batches)
        }));

        const headers = ["BatchID", "BatchNo", "ProductName", "BatchStatus", "TotalProductionBatches", "QCPendingBatches", "CompletedBatches", "RejectedBatches"];

        if (format === 'csv') {
            const fields = headers.map(h => ({ label: h, value: h }));
            const parser = new Parser({ fields });
            const csv = parser.parse(reportData);
            return { status: true, format: 'csv', csv, filename: 'quality_control_report.csv' };
        }

        return { status: true, format: 'json', headers, data: reportData };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

// sorting params =(current_month,last_month,last_3_months,last_3_months,current_year ,startDate=,endDate=)
// endpoint  http://localhost:5000/api/expenditure/quality-operationEfficiency-report
// Suggested function name: generateQualityControlReport
// Suggested function name: generateQualityControlReport

exports.generateOperationalEfficiencyReportService = async (params = {}) => {
    const client = await pool.connect();
    try {
        const { filter = 'current_month', startDate, endDate, format = 'json' } = params;

        let fromDate = null, toDate = null;
        const now = new Date();

        if (startDate && endDate) {
            const parseDate = (d) => { const [day, month, year] = d.split('-'); return new Date(`${year}-${month}-${day}`); };
            fromDate = parseDate(startDate); fromDate.setHours(0, 0, 0, 0);
            toDate = parseDate(endDate); toDate.setHours(23, 59, 59, 999);
        } else {
            switch (filter) {
                case 'last_month':
                    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'last_3_months':
                    fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3); toDate = now;
                    break;
                case 'current_year':
                    fromDate = new Date(now.getFullYear(), 0, 1); toDate = now;
                    break;
                case 'current_month':
                default:
                    fromDate = new Date(now.getFullYear(), now.getMonth(), 1); toDate = now;
            }
        }

        const dateCondition = fromDate && toDate
            ? `AND pb.created_at >= '${fromDate.toISOString()}' AND pb.created_at <= '${toDate.toISOString()}'`
            : '';

        const query = `
            SELECT
                b.batch_no,
                p.product_name,
                pb.planned_qty,
                pb.produced_qty,
                CASE WHEN pb.planned_qty>0 THEN ROUND((pb.produced_qty/pb.planned_qty)*100,2) ELSE 0 END AS efficiency_percentage,
                COALESCE(SUM(brmc.qty_consumed*brmc.rate),0) AS raw_material_cost,
                COALESCE(SUM(be.total_cost),0) AS batch_expense,
                COALESCE(SUM(oe.amount),0) AS operation_expense
            FROM production_batches pb
            LEFT JOIN batches b ON b.id = pb.batch_id
            LEFT JOIN products p ON p.id = pb.product_id
            LEFT JOIN batch_raw_material_consumptions brmc ON brmc.production_batch_id = pb.id
            LEFT JOIN batch_expenses be ON be.production_batch_id = pb.id
            LEFT JOIN operation_expenses oe ON oe.production_batch_id = pb.id
            WHERE 1=1 ${dateCondition}
            GROUP BY pb.id, b.batch_no, p.product_name, pb.planned_qty, pb.produced_qty
            ORDER BY pb.created_at DESC;
        `;

        const { rows } = await client.query(query);

        const reportData = rows.map(r => ({
            BatchNo: r.batch_no,
            ProductName: r.product_name,
            PlannedQty: parseFloat(r.planned_qty),
            ProducedQty: parseFloat(r.produced_qty),
            EfficiencyPercent: parseFloat(r.efficiency_percentage),
            RawMaterialCost: parseFloat(r.raw_material_cost),
            BatchExpense: parseFloat(r.batch_expense),
            OperationExpense: parseFloat(r.operation_expense)
        }));

        const headers = ["BatchNo", "ProductName", "PlannedQty", "ProducedQty", "EfficiencyPercent", "RawMaterialCost", "BatchExpense", "OperationExpense"];

        if (format === 'csv') {
            const fields = headers.map(h => ({ label: h, value: h }));
            const parser = new Parser({ fields });
            const csv = parser.parse(reportData);
            return { status: true, format: 'csv', csv, filename: 'operational_efficiency_report.csv' };
        }

        return { status: true, format: 'json', headers, data: reportData };

    } catch (error) {
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

















