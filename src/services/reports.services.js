const { sqlQueryFun } = require("../database/sql/sqlFunction");

exports.getProductExpenditureService1 = async (article_sku) => {
  try {
    const query = `
  SELECT 
    rm.id AS raw_material_id,
    rm.name AS raw_material_name,
    SUM(poi.qty * poi.rate) AS total_purchase_cost,
    COALESCE(SUM(bc.qty_consumed), 0) AS qty_used,
    COALESCE(SUM(rmb.qty_received),0) - COALESCE(SUM(bc.qty_consumed),0) AS waste_qty
FROM raw_materials rm
JOIN purchase_order_items poi ON poi.raw_material_id = rm.id
JOIN purchase_orders po ON po.id = poi.purchase_order_id
LEFT JOIN raw_material_batches rmb ON rmb.raw_material_id = rm.id
LEFT JOIN batch_consumptions bc ON bc.raw_material_batch_id = rmb.id
LEFT JOIN production_batches pb ON bc.production_batch_id = pb.id
WHERE pb.article_sku = $1
GROUP BY rm.id, rm.name`;

  const result = await sqlQueryFun(query, [article_sku]);
  return {status:true,data:result,message:"reports fetch successfully"};
  } catch (error) {
    return { status:false, message:`something went wrog please try after some times (${error.message})` }
  }
};

        //   pb.produced_qty,

exports.getProductExpenditureService = async () => {
  try {
    const query = `
      WITH batch_data AS (
        SELECT 
          pb.id AS batch_id,
          pb.batch_no,
          pb.article_sku,
          pb.planned_qty,
          pb.status,
          TO_CHAR(pb.start_date, 'DD/MM/YYYY') AS start_date,
          COALESCE(SUM(bc.qty_consumed * rmb.cost_per_unit), 0) AS material_cost,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'raw_material', rm.name,
              'qty_consumed', bc.qty_consumed,
              'cost_per_unit', rmb.cost_per_unit,
              'total_cost', bc.qty_consumed * rmb.cost_per_unit,
              'waste_qty', rmb.qty_received - bc.qty_consumed
            )
          ) FILTER (WHERE bc.id IS NOT NULL) AS materials
        FROM production_batches pb
        LEFT JOIN batch_consumptions bc ON bc.production_batch_id = pb.id
        LEFT JOIN raw_material_batches rmb ON rmb.id = bc.raw_material_batch_id
        LEFT JOIN raw_materials rm ON rm.id = rmb.raw_material_id
        GROUP BY pb.id
      )
      SELECT 
        *,
        SUM(material_cost) OVER (PARTITION BY article_sku) AS total_product_expenditure
      FROM batch_data
      ORDER BY start_date DESC;
    `;

    const result = await sqlQueryFun(query, []);

    return {
      status: true,
      data: result,
      message: "Production batch report with total product expenditure fetched successfully."
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`
    };
  }
};

exports.getMonthlyExpensesReportService2 = async (query) => {
  try {
    const query = `
      WITH current_month AS (
        SELECT 
          SUM(poi.qty * poi.rate) AS materials_cost,
          COALESCE(SUM(bc.cost), 0) AS production_cost,
          COALESCE(SUM(oe.amount), 0) AS operations_cost
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        LEFT JOIN batch_consumptions bc ON bc.production_batch_id = po.id
        LEFT JOIN operation_expenses oe ON EXTRACT(MONTH FROM oe.expense_date) = EXTRACT(MONTH FROM CURRENT_DATE)
        WHERE EXTRACT(MONTH FROM po.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
      ),
      last_month AS (
        SELECT 
          SUM(poi.qty * poi.rate) AS materials_cost,
          COALESCE(SUM(bc.cost), 0) AS production_cost,
          COALESCE(SUM(oe.amount), 0) AS operations_cost
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        LEFT JOIN batch_consumptions bc ON bc.production_batch_id = po.id
        LEFT JOIN operation_expenses oe ON EXTRACT(MONTH FROM oe.expense_date) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        WHERE EXTRACT(MONTH FROM po.created_at) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      )
      SELECT 
        cm.materials_cost AS current_materials,
        lm.materials_cost AS last_materials,
        cm.production_cost AS current_production,
        lm.production_cost AS last_production,
        cm.operations_cost AS current_operations,
        lm.operations_cost AS last_operations
      FROM current_month cm, last_month lm;
    `;
    
    const [result] = await sqlQueryFun(query, []);
    
    const calcPercentChange = (current, last) => last ? (((current - last) / last) * 100).toFixed(1) : null;
    
    const data = {
      total_expense: result.current_materials + result.current_production + result.current_operations,
      total_expense_change: calcPercentChange(
        result.current_materials + result.current_production + result.current_operations,
        result.last_materials + result.last_production + result.last_operations
      ),
      materials_cost: result.current_materials,
      materials_change: calcPercentChange(result.current_materials, result.last_materials),
      production_cost: result.current_production,
      production_change: calcPercentChange(result.current_production, result.last_production),
      operations_cost: result.current_operations,
      operations_change: calcPercentChange(result.current_operations, result.last_operations),
    };

    return { status: true, data, message: "Monthly expenses report fetched successfully" };
  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};






//   let result2 = await sqlQueryFun('SELECT * FROM production_batches LIMIT 5');
//   console.log("<><>production_batches",result2)
//   result2 = await sqlQueryFun(`SELECT * FROM batch_consumptions LIMIT 5;`);
//   console.log("<><>batch_consumptions",result2)
//   result2 = await sqlQueryFun(`SELECT * FROM raw_material_batches LIMIT 5;`);
//   console.log("<><>raw_material_batches",result2)
//   result2 = await sqlQueryFun(`SELECT * FROM purchase_order_items LIMIT 5`);
//   console.log("<><>purchase_order_items",result2)
//   result2 = await sqlQueryFun(`SELECT * FROM purchase_orders LIMIT 5`);
//   console.log("<><>purchase_orders",result2)
//   result2 = await sqlQueryFun(`SELECT * FROM raw_materials LIMIT 5`);
//   console.log("<><>raw_materials",result2)
//   console.log("<><>result",result)