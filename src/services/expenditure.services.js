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
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    const lastMonthDate = new Date(currentDate);
    lastMonthDate.setMonth(currentMonth - 2); // JS months are 0-indexed
    const lastMonth = lastMonthDate.getMonth() + 1;
    const lastMonthYear = lastMonthDate.getFullYear();

    // --- Helper to calculate totals ---
    const sqlTotals = (month, year) => `
      SELECT
        COALESCE(SUM(poi.qty * poi.rate), 0) AS materials_cost,
        COALESCE(SUM(bc.qty_consumed * rmb.cost_per_unit), 0) AS production_cost,
        COALESCE(SUM(oe.amount), 0) AS operations_cost
      FROM purchase_order_items poi
      LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN batch_consumptions bc
        ON bc.production_batch_id = po.id -- optionally adjust if production batch relation differs
      LEFT JOIN raw_material_batches rmb ON rmb.id = bc.raw_material_batch_id
      LEFT JOIN operation_expenses oe
        ON EXTRACT(MONTH FROM oe.expense_date) = ${month}
        AND EXTRACT(YEAR FROM oe.expense_date) = ${year}
      WHERE EXTRACT(MONTH FROM po.created_at) = ${month} 
        AND EXTRACT(YEAR FROM po.created_at) = ${year};
    `;

    // --- Helper to fetch detailed entries ---
    const sqlDetails = (month, year) => `
      SELECT * FROM (
        -- Purchase Order Costs
        SELECT 
          poi.qty * poi.rate AS amount,
          'cost' AS type,
          po.created_at AS date,
          'PO-' || po.po_no AS reference,
          rm.name AS description
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN raw_materials rm ON rm.id = poi.raw_material_id
        WHERE EXTRACT(MONTH FROM po.created_at) = ${month} 
          AND EXTRACT(YEAR FROM po.created_at) = ${year}

        UNION ALL

        -- Production Costs
        SELECT 
          bc.qty_consumed * rmb.cost_per_unit AS amount,
          'cost' AS type,
          pb.start_date AS date,
          'PB-' || pb.batch_no AS reference,
          rm.name AS description
        FROM batch_consumptions bc
        JOIN raw_material_batches rmb ON rmb.id = bc.raw_material_batch_id
        JOIN production_batches pb ON pb.id = bc.production_batch_id
        JOIN raw_materials rm ON rm.id = rmb.raw_material_id
        WHERE EXTRACT(MONTH FROM pb.start_date) = ${month} 
          AND EXTRACT(YEAR FROM pb.start_date) = ${year}

        UNION ALL

        -- Operations Expenses
        SELECT
          amount,
          'expense' AS type,
          expense_date AS date,
          NULL AS reference,
          expense_type AS description
        FROM operation_expenses
        WHERE EXTRACT(MONTH FROM expense_date) = ${month}
          AND EXTRACT(YEAR FROM expense_date) = ${year}
      ) AS combined
      ORDER BY date DESC;
    `;

    // --- Fetch totals ---
    const [current] = await sqlQueryFun(sqlTotals(currentMonth, currentYear));
    const [last] = await sqlQueryFun(sqlTotals(lastMonth, lastMonthYear));

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
      totals: {
        total_expense: totalExpenseCurrent,
        total_expense_change: calcPercentChange(totalExpenseCurrent, totalExpenseLast),
        materials_cost: Number(current.materials_cost || 0),
        materials_change: calcPercentChange(current.materials_cost, last.materials_cost),
        production_cost: Number(current.production_cost || 0),
        production_change: calcPercentChange(current.production_cost, last.production_cost),
        operations_cost: Number(current.operations_cost || 0),
        operations_change: calcPercentChange(current.operations_cost, last.operations_cost),
      },
      details: await sqlQueryFun(sqlDetails(currentMonth, currentYear))
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
