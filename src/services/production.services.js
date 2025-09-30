const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createProductionService = async (body, userId) => {
  try {
    const { batch_no, article_sku, planned_qty, start_date, end_date, status, batch_consumptions } = body;

    // Step 1: Insert into production_batches
    const insertBatchQuery = `
      INSERT INTO production_batches (
        batch_no, article_sku, planned_qty, start_date, end_date, status
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'planned'))
      RETURNING *;
    `;

    const batchValues = [
      batch_no,
      article_sku,
      planned_qty,
      start_date || null,
      end_date || null,
      status
    ];

    const batchResult = await sqlQueryFun(insertBatchQuery, batchValues);
    const newBatch = batchResult[0];

    // Step 2: Insert batch_consumptions if array is provided
    let insertedConsumptions = [];
    if (Array.isArray(batch_consumptions) && batch_consumptions.length > 0) {
      for (const item of batch_consumptions) {
        const { raw_material_batch_id, qty_consumed, cost } = item;

        const insertConsumptionQuery = `
          INSERT INTO batch_consumptions (
            production_batch_id, raw_material_batch_id, qty_consumed, cost
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *;
        `;

        const values = [
          newBatch.id,
          raw_material_batch_id,
          qty_consumed,
          cost || null
        ];

        const consumptionResult = await sqlQueryFun(insertConsumptionQuery, values);
        insertedConsumptions.push(consumptionResult[0]);
      }
    }

    // Step 3: Return response
    return {
      status: true,
      data: {
        ...newBatch,
        batch_consumptions: insertedConsumptions
      },
      message: "Production batch created successfully with consumptions."
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    };
  }
};


exports.getAllProductionService = async (query) => {
  try {
    
    return {
      status: true,
      data: result,
      total: parseInt(countResult.total),
      message: "Productions fetched successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};

exports.updateProductionService = async (id, body) => {
  try {
   
    
    return { status: true,data: result[0],message: "Production updated successfully."};
  } catch (error) {
    return { status: false,message: `Something went wrong. (${error.message})`,};
  }
};

exports.deleteProductionService = async (id) => {
  try {
   

    return { status: true, data: result[0], message: "GRN deleted successfully." };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`,
    };
  }
};