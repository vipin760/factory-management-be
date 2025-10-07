const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction");

exports.getMonthlyExpensesReportService1 = async () => {
    try {
        // Get current month and last month
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        const lastMonthDate = new Date(currentDate);
        lastMonthDate.setMonth(currentMonth - 2); // JS months are 0-indexed
        const lastMonth = lastMonthDate.getMonth() + 1;
        const lastMonthYear = lastMonthDate.getFullYear();

        // Helper SQL snippet
        const sql = (month, year) => `
      SELECT
        COALESCE(SUM(poi.qty * poi.rate), 0) AS materials_cost,
        COALESCE(SUM(bc.cost), 0) AS production_cost,
        COALESCE(SUM(oe.amount), 0) AS operations_cost
      FROM purchase_order_items poi
      LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN batch_consumptions bc ON bc.production_batch_id = po.id
      LEFT JOIN operation_expenses oe ON EXTRACT(MONTH FROM oe.expense_date) = ${month} 
                                      AND EXTRACT(YEAR FROM oe.expense_date) = ${year}
      WHERE EXTRACT(MONTH FROM po.created_at) = ${month} 
        AND EXTRACT(YEAR FROM po.created_at) = ${year};
    `;

        // Current month
        const [current] = await sqlQueryFun(sql(currentMonth, currentYear));
        // Last month
        const [last] = await sqlQueryFun(sql(lastMonth, lastMonthYear));

        const calcPercentChange = (current, last) => {
            current = Number(current) || 0;
            last = Number(last) || 0;
            if (last === 0) return "N/A";
            return (((current - last) / last) * 100).toFixed(1);
        };

        const totalExpenseCurrent = Number(current.materials_cost || 0) +
            Number(current.production_cost || 0) +
            Number(current.operations_cost || 0);

        const totalExpenseLast = Number(last.materials_cost || 0) +
            Number(last.production_cost || 0) +
            Number(last.operations_cost || 0);

        const data = {
            total_expense: totalExpenseCurrent,
            total_expense_change: calcPercentChange(totalExpenseCurrent, totalExpenseLast),
            materials_cost: Number(current.materials_cost || 0),
            materials_change: calcPercentChange(current.materials_cost, last.materials_cost),
            production_cost: Number(current.production_cost || 0),
            production_change: calcPercentChange(current.production_cost, last.production_cost),
            operations_cost: Number(current.operations_cost || 0),
            operations_change: calcPercentChange(current.operations_cost, last.operations_cost),
        };

        return {
            status: true,
            data,
            message: "Monthly expenses report fetched successfully"
        };

    } catch (error) {
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    }
};

exports.getMonthlyExpensesReportService2 = async () => {
    const client = await pool.connect();

    try {
        // 1️⃣ Aggregate monthly production costs
        const monthlyCostsQuery = `
            SELECT
                TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS total_material_cost,
                COALESCE(SUM(be.qty * be.rate), 0) AS total_operation_expense,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.qty * be.rate), 0)) AS total_production_cost,
                (COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) + COALESCE(SUM(be.qty * be.rate), 0)) AS grand_total_cost
            FROM production_batches pb
            LEFT JOIN batch_raw_material_consumptions brmc 
                ON pb.id = brmc.production_batch_id
            LEFT JOIN batch_expenses be 
                ON pb.id = be.production_batch_id
            GROUP BY TO_CHAR(pb.created_at, 'YYYY-MM')
            ORDER BY month ASC;
        `;
        const monthlyCostsResult = await client.query(monthlyCostsQuery);

        // ✅ Calculate % change month-over-month
        const monthlyCosts = monthlyCostsResult.rows.map((row, index, arr) => {
            const current = {
                month: row.month,
                total_material_cost: Number(row.total_material_cost),
                total_operation_expense: Number(row.total_operation_expense),
                total_production_cost: Number(row.total_production_cost),
                grand_total_cost: Number(row.grand_total_cost)
            };

            if (index === 0) {
                return {
                    ...current,
                    change_from_last_month: {
                        total_material_cost: "N/A",
                        total_operation_expense: "N/A",
                        total_production_cost: "N/A",
                        grand_total_cost: "N/A"
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
                    SUM(be.qty * be.rate) AS total_operation_expense
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
                    (COALESCE(bmc.total_material_cost, 0) + COALESCE(boc.total_operation_expense, 0)) AS total_cost,
                    TO_CHAR(b.created_at, 'YYYY-MM-DD') AS date
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
                total_cost
            FROM combined_costs
            ORDER BY date DESC;
        `;

        const detailedRecordsResult = await client.query(detailedRecordsQuery);

        const detailedRecords = detailedRecordsResult.rows.map(row => ({
            title: row.title,
            date: row.date,
            material_cost: Number(row.total_material_cost || 0),
            operation_expense: Number(row.total_operation_expense || 0),
            amount: Number(row.total_cost || 0),
            ref_no: row.ref_no || null,
            type: "cost"
        }));

        // ✅ Return structured report
        return {
            status: true,
            data: {
                monthlyCosts,
                detailedRecords
            },
            message: "Monthly production and expense report fetched successfully"
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

exports.getMonthlyExpensesReportService3 = async () => {
    const client = await pool.connect();

    try {
        // 1️⃣ Aggregate monthly production costs including Utility Expenses
        const monthlyCostsQuery = `
            SELECT
                TO_CHAR(pb.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(brmc.qty_consumed * brmc.rate), 0) AS total_material_cost,
                COALESCE(SUM(be.total_cost), 0) AS total_operation_expense,
                COALESCE(SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END),0) AS utility_expense,
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

        // 2️⃣ Calculate % change month-over-month
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
                        total_material_cost: "N/A",
                        total_operation_expense: "N/A",
                        utility_expense: "N/A",
                        total_production_cost: "N/A",
                        grand_total_cost: "N/A"
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

        // 3️⃣ Detailed batch-wise cost records including operation expenses
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
                    SUM(CASE WHEN be.expense_category='utility' THEN be.total_cost ELSE 0 END) AS utility_expense
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
                    COALESCE(boc.utility_expense,0) AS utility_expense,
                    (COALESCE(bmc.total_material_cost, 0) + COALESCE(boc.total_operation_expense, 0)) AS total_cost,
                    TO_CHAR(b.created_at, 'YYYY-MM-DD') AS date,
                    b.created_at
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
                created_at
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
            last_updated: row.updated_at
        }));

        // 4️⃣ Vendor-wise total payment
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

        // 5️⃣ Total Utility Expenses (like a new table)
        const utilityExpenseQuery = `
            SELECT 
                'Factory Utilities' AS name,
                MAX(created_at) AS date,
                SUM(total_cost) AS amount
            FROM batch_expenses
            WHERE expense_category='utility';
        `;
        const utilityExpenseResult = await client.query(utilityExpenseQuery);

        const utilityExpenses = utilityExpenseResult.rows.map(row => ({
            name: row.name,
            date: row.date,
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

exports.getMonthlyExpensesReportService = async () => {
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










