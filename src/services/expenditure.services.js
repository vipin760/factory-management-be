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

exports.getMonthlyExpensesReportService = async () => {
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
      ORDER BY month DESC;
    `;

    const monthlyCostsResult = await client.query(monthlyCostsQuery);

    const monthlyCosts = monthlyCostsResult.rows.map(row => ({
      month: row.month,
      total_material_cost: Number(row.total_material_cost),
      total_operation_expense: Number(row.total_operation_expense),
      total_production_cost: Number(row.total_production_cost),
      grand_total_cost: Number(row.grand_total_cost)
    }));

    // 2️⃣ Detailed cost & expense records
    const detailedRecordsQuery = `
      -- a) Raw Material Purchases
      SELECT
        rm.name AS title,
        po.purchase_order_id AS ref_no,
        TO_CHAR(po.created_at, 'YYYY-MM-DD') AS date,
        SUM(poi.qty * poi.rate) AS amount,
        'cost' AS type
      FROM purchase_order_items poi
      JOIN raw_materials rm ON rm.id = poi.raw_material_id
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      GROUP BY rm.name, po.purchase_order_id, po.created_at

      UNION ALL

      -- b) Production Batch Costs
      SELECT
        CONCAT('Production Batch - ', p.product_name) AS title,
        b.batch_no AS ref_no,
        TO_CHAR(pb.created_at, 'YYYY-MM-DD') AS date,
        COALESCE(material.total_material, 0) + COALESCE(expense.total_expense, 0) AS amount,
        'cost' AS type
      FROM production_batches pb
      JOIN batches b ON pb.batch_id = b.id
      JOIN products p ON pb.product_id = p.id
      LEFT JOIN (
        SELECT production_batch_id, SUM(qty_consumed * rate) AS total_material
        FROM batch_raw_material_consumptions
        GROUP BY production_batch_id
      ) material ON pb.id = material.production_batch_id
      LEFT JOIN (
        SELECT production_batch_id, SUM(qty * rate) AS total_expense
        FROM batch_expenses
        GROUP BY production_batch_id
      ) expense ON pb.id = expense.production_batch_id

      UNION ALL

      -- c) Factory / Utility Expenses
      SELECT
        INITCAP(be.expense_category) AS title,
        NULL AS ref_no,
        TO_CHAR(be.created_at, 'YYYY-MM-DD') AS date,
        COALESCE(be.qty * be.rate, 0) AS amount,
        'expense' AS type
      FROM batch_expenses be
      WHERE be.expense_category ILIKE 'utility' OR be.expense_category ILIKE 'labour'

      ORDER BY date DESC;
    `;

    const detailedRecordsResult = await client.query(detailedRecordsQuery);

    const detailedRecords = detailedRecordsResult.rows.map(row => ({
      title: row.title,
      date: row.date,
      amount: Number(row.amount || 0),
      type: row.type,       // 'cost' or 'expense'
      ref_no: row.ref_no || null
    }));

    // Return structured report
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

