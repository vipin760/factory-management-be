const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createRawMaterialService = async (data) => {
    try {
        const { code, name, description, uom, category, batchable, reorder_level } = data
        if (!name) return { status: false, data: [], message: "name field required" }
        if (!uom) return { status: false, data: [], message: "uom field required" }
        if (!code) return { status: false, data: [], message: "code field required" }

        const rawMaterialsExistQry = `SELECT * FROM raw_materials WHERE code = $1`
        const rawMaterialsExistVal = [code]
        const checkRawMaterialExist = await sqlQueryFun(rawMaterialsExistQry, rawMaterialsExistVal)
        if (checkRawMaterialExist.length != 0) return { status: false, message: "raw material code already exist" }

        const query = `
    INSERT INTO raw_materials (code, name, description, uom, category, batchable, reorder_level)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
        const values = [code, name, description || null, uom, category || null, batchable ?? true, reorder_level ?? 0];
        const result = await sqlQueryFun(query, values);
        return { status: true, data: result, message: "raw materials created successfully" }
    } catch (error) {
        return { status: false, message: error.message }
    }
}

exports.fetchRawMaterialService = async (queryParams) => {
    try {
        let { page, limit, search, sort_by, sort_order } = queryParams;
        page = parseInt(page) || 1;
        limit = parseInt(limit) || null;
        sort_by = sort_by || 'created_at';
        sort_order = sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let baseQuery = `SELECT * FROM raw_materials`;
        let countQuery = `SELECT COUNT(*) FROM raw_materials`;
        let values = [];

        if (search) {
            baseQuery += ` WHERE code ILIKE $1 OR name ILIKE $1 OR category ILIKE $1`;
            countQuery += ` WHERE code ILIKE $1 OR name ILIKE $1 OR category ILIKE $1`;
            values.push(`%${search}%`);
        }

        baseQuery += ` ORDER BY ${sort_by} ${sort_order}`;

        if (limit) {
            const offset = (page - 1) * limit;
            baseQuery += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
            values.push(limit, offset);
        }

        const response = await sqlQueryFun(baseQuery, values);
        const countResult = await sqlQueryFun(countQuery, search ? [`%${search}%`] : []);
        const total = parseInt(countResult[0].count);

        const result = { response, total, page: limit ? page : 1, limit: limit || total }
        return {
            status: true,
            data: result,
            message: "Raw materials fetched successfully"
        };
    } catch (error) {
        return { status: false, message: error.message };
    }
};

exports.deleteRawMaterialService = async (id) => {
    try {
        const checkQuery = `SELECT * FROM raw_materials WHERE id = $1`;
        const existing = await sqlQueryFun(checkQuery, [id]);
        if (existing.length === 0) {
            return { status: false, message: "Raw material not found" };
        }
        
        const deleteQuery = `DELETE FROM raw_materials WHERE id = $1 RETURNING *`;
        const result = await sqlQueryFun(deleteQuery, [id]);

        return { status: true, data: result, message: "Raw material deleted successfully" };
    } catch (error) {
        return { status: false, message: error.message };
    }
};

exports.updateRawMaterialService = async (id, data) => {
  try {
    const { code, name, description, uom, category, batchable, reorder_level } = data;
    const existingQuery = `SELECT * FROM raw_materials WHERE id = $1`;
    const existing = await sqlQueryFun(existingQuery, [id]);
    if (existing.length === 0) {
      return { status: false, message: "Raw material not found" };
    }
    if (code && code !== existing[0].code) {
      const codeCheckQuery = `SELECT * FROM raw_materials WHERE code = $1 AND id != $2`;
      const codeExists = await sqlQueryFun(codeCheckQuery, [code, id]);
      if (codeExists.length > 0) {
        return { status: false, message: "Raw material code already exists" };
      }
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (code !== undefined) { fields.push(`code = $${idx++}`); values.push(code); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (uom !== undefined) { fields.push(`uom = $${idx++}`); values.push(uom); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }
    if (batchable !== undefined) { fields.push(`batchable = $${idx++}`); values.push(batchable); }
    if (reorder_level !== undefined) { fields.push(`reorder_level = $${idx++}`); values.push(reorder_level); }

    if (fields.length === 0) {
      return { status: false, message: "No fields provided to update" };
    }

    const updateQuery = `
      UPDATE raw_materials
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;
    values.push(id);
    const result = await sqlQueryFun(updateQuery, values);
    return { status: true, data: result, message: "Raw material updated successfully" };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// Raw material batches services
exports.createRawMaterialBatchesService = async(body)=>{
   const { raw_material_id, batch_no, qty_received = 0,qty_available = 0,cost_per_unit = 0,mfg_date,exp_date,location} = body;
   try {
      //  const rawMaterialsBatchesExistQry = `SELECT * FROM raw_materials WHERE code = $1`
      //   const rawMaterialsBatchesExistVal = [code]
      //   const checkRawMaterialBatchesExist = await sqlQueryFun(rawMaterialsBatchesExistQry,rawMaterialsBatchesExistVal);
      //   if(checkRawMaterialBatchesExist.length != 0){
      //     return {status:false,message:`raw material batch_no:(${batch_no}) already exist`}
      //   }

      const insertQuery = `INSERT INTO raw_material_batches (raw_material_id, batch_no, qty_received, qty_available, cost_per_unit, mfg_date, exp_date, location) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
  const values = [raw_material_id,batch_no,qty_received,qty_available,cost_per_unit,mfg_date || null,exp_date || null,location || null];
    const rows = await sqlQueryFun(insertQuery,values)
    return { status: true, data: rows[0], message: "Raw material batch created successfully" };
  } catch (error) {
    return { status:false, message:`Something went wrong (${error.message})`}
  }
}

exports.getAllRawMaterialBatchesService1 = async (queryParams) => {
  try {
    let { 
      search,               // keyword search (batch_no, location, raw_material_name)
      raw_material_name,    // filter specifically by raw material name
      start_date,           // filter by mfg_date >=
      end_date,             // filter by exp_date <=
      sort_by = "created_at", 
      sort_order = "DESC", 
      limit, 
      offset = 0 
    } = queryParams;

    let baseQuery = `
      SELECT rb.*, rm.name AS raw_material_name, rm.code AS raw_material_code, rm.uom, rm.category
      FROM raw_material_batches rb
      JOIN raw_materials rm ON rb.raw_material_id = rm.id
      WHERE 1=1
    `;

    let values = [];
    let conditions = [];

    // 🔍 General Search (batch_no, location, raw_material_name)
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(rb.batch_no ILIKE $${values.length} OR rb.location ILIKE $${values.length} OR rm.name ILIKE $${values.length})`);
    }

    // 🎯 Filter by raw material name
    if (raw_material_name) {
      values.push(`%${raw_material_name}%`);
      conditions.push(`rm.name ILIKE $${values.length}`);
    }

    // 📅 Filter by manufacturing date (>= start_date)
    if (start_date) {
      values.push(start_date);
      conditions.push(`rb.mfg_date >= $${values.length}`);
    }

    // 📅 Filter by expiry date (<= end_date)
    if (end_date) {
      values.push(end_date);
      conditions.push(`rb.exp_date <= $${values.length}`);
    }

    // Apply conditions
    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }

    // Sorting
    const validSortColumns = ["created_at", "batch_no", "qty_available", "mfg_date", "exp_date", "cost_per_unit"];
    if (!validSortColumns.includes(sort_by)) sort_by = "created_at"; // fallback
    sort_order = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    baseQuery += ` ORDER BY rb.${sort_by} ${sort_order}`;

    // Pagination
    if (limit) {
      values.push(limit);
      values.push(offset);
      baseQuery += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }

    const rows = await sqlQueryFun(baseQuery, values);
if(rows.length == 0){
  return { status: true, data: [], message: "Raw material batches not found" };
}
 
return { status: true, data: rows, message: "Raw material batches fetched successfully" };

  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};

exports.getAllRawMaterialBatchesService = async (queryParams) => {
  try {
    let { 
      search, 
      raw_material_name, 
      start_date, 
      end_date, 
      sort_by = "created_at", 
      sort_order = "DESC", 
      limit, 
      page = 1 
    } = queryParams;

    let baseQuery = `
      FROM raw_material_batches rb
      JOIN raw_materials rm ON rb.raw_material_id = rm.id
      WHERE 1=1
    `;

    let values = [];
    let conditions = [];

    // General search
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(rb.batch_no ILIKE $${values.length} OR rb.location ILIKE $${values.length} OR rm.name ILIKE $${values.length})`);
    }

    if (raw_material_name) {
      values.push(`%${raw_material_name}%`);
      conditions.push(`rm.name ILIKE $${values.length}`);
    }

    if (start_date) {
      values.push(start_date);
      conditions.push(`rb.mfg_date >= $${values.length}`);
    }

    if (end_date) {
      values.push(end_date);
      conditions.push(`rb.exp_date <= $${values.length}`);
    }

    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }

    // 1️⃣ Get total count
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await sqlQueryFun(countQuery, values);
    const total = parseInt(countResult[0].count, 10);

    // 2️⃣ Apply sorting
    const validSortColumns = ["created_at", "batch_no", "qty_available", "mfg_date", "exp_date", "cost_per_unit"];
    if (!validSortColumns.includes(sort_by)) sort_by = "created_at";
    sort_order = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 3️⃣ Apply pagination
    let paginatedQuery = `SELECT rb.*, rm.name AS raw_material_name, rm.code AS raw_material_code, rm.uom, rm.category ${baseQuery} ORDER BY rb.${sort_by} ${sort_order}`;
    if (limit && limit !== "all") {
      const limitNum = parseInt(limit, 10);
      const offsetNum = (parseInt(page, 10) - 1) * limitNum;
      values.push(limitNum, offsetNum);
      paginatedQuery += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }

    const response = await sqlQueryFun(paginatedQuery, values);

    // 4️⃣ Calculate total pages
    const totalPages = limit && limit !== "all" ? Math.ceil(total / parseInt(limit, 10)) : 1;

    const result = {
      response,
      total,
      page: limit && limit !== "all" ? parseInt(page, 10) : 1,
      limit: limit && limit !== "all" ? parseInt(limit, 10) : total,
      totalPages
    };

    return {
      status: true,
      data: result,
      message: "Raw materials fetched successfully"
    };

  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};



