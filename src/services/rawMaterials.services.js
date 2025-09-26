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
