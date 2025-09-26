const { sqlQueryFun } = require("../database/sql/sqlFunction")

exports.createIndentService = async (body, userId) => {
    try {
        const { indent_no, status, required_by, priority, notes, items } = body
        if (!indent_no) return { status: false, data: [], message: "indent_no field required" }
        if (!userId) return { status: false, data: [], message: "requested_by field required" }
        const indentExistQry = 'SELECT * FROM indents WHERE indent_no=$1'
        const indentExistVal = [indent_no]

        const indentExist = await sqlQueryFun(indentExistQry, indentExistVal);
        if (indentExist.length) return { status: false, data: indentExist, message: "An indent with this number already exists" }

        const insertIndentQry = `INSERT INTO indents (indent_no, requested_by, status, required_by, priority, notes)
    VALUES ( $1, $2, $3, $4, $5, $6)
    RETURNING *`
        const insertIndentVal = [indent_no, userId, status, required_by, priority, notes]

        const [newIndent] = await sqlQueryFun(insertIndentQry, insertIndentVal)

        if (items && Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                const { raw_material_id, qty, uom, notes: itemNotes } = item;

                if (!qty || !uom) {
                    return { status: false, data: [], message: "Each item must have raw_material_id, qty, and uom" };
                }

                const insertItemQry = `
          INSERT INTO indent_items (indent_id, raw_material_id, qty, uom, notes)
          VALUES ($1, $2, $3, $4, $5)`;
                const insertItemVal = [newIndent.id, raw_material_id, qty, uom, itemNotes || null];

                await sqlQueryFun(insertItemQry, insertItemVal);
            }
        }

        return { status: true, data: newIndent, message: "Indent has been created successfully" }
    } catch (error) {
        return { status: false, data: [], message: error.message }
    }

}

exports.getAllIndentService = async (queryParams) => {
  try {
    let { page, limit, sortBy, sortOrder } = queryParams;
    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;
    sortBy = sortBy || 'created_at';
    sortOrder = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    let baseQuery = `
      SELECT 
        i.*,
        u.name AS requested_by_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ii.id,
              'indent_id', ii.indent_id,
              'raw_material_id', ii.raw_material_id,
              'qty', ii.qty,
              'uom', ii.uom,
              'notes', ii.notes,
              'raw_material', json_build_object(
                'id', rm.id,
                'code', rm.code,
                'name', rm.name,
                'description', rm.description,
                'uom', rm.uom,
                'category', rm.category,
                'batchable', rm.batchable,
                'reorder_level', rm.reorder_level
              )
            )
          ) FILTER (WHERE ii.id IS NOT NULL),
          '[]'
        ) AS items
      FROM indents i
      LEFT JOIN users u ON u.id = i.requested_by
      LEFT JOIN indent_items ii ON ii.indent_id = i.id
      LEFT JOIN raw_materials rm ON rm.id = ii.raw_material_id
      GROUP BY i.id, u.name
      ORDER BY ${sortBy} ${sortOrder}
    `;

    if (limit) {
      const offset = (page - 1) * limit;
      baseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    // Add the semicolon only once at the very end
    baseQuery += ';';

    const indents = await sqlQueryFun(baseQuery, []);
    const countResult = await sqlQueryFun(`SELECT COUNT(*) AS total FROM indents`, []);
    const total = parseInt(countResult[0]?.total || 0);

    return {
      status: true,
      data: { indents, total, page, limit: limit || total },
      message: 'Indents fetched successfully',
    };
  } catch (error) {
    return {
      status: false,
      data: [],
      message: error.message || 'Something went wrong while fetching indents',
    };
  }
};

exports.deleteIndentService = async (id) => {
    try {
        if (!id) return { status: false, data: [], message: "Indent ID is required" };

        const checkQuery = `SELECT * FROM indents WHERE id = $1`;
        const existing = await sqlQueryFun(checkQuery, [id]);
        if (!existing.length) return { status: false, data: [], message: "Indent not found" };

        const deleteQuery = `DELETE FROM indents WHERE id = $1`;
        await sqlQueryFun(deleteQuery, [id])

        return { status: true, data: [], message: `Indent "${existing[0].indent_no}" has been deleted successfully` };
    } catch (error) {
        return { status: false, data: [], message: error.message }
    }
}

exports.updateIndentService1 = async (body, id) => {
    try {
        if (!id) return { status: false, data: [], message: "Indent ID is required" }

        const checkQuery = `SELECT * FROM indents WHERE id = $1`;
        const existing = await sqlQueryFun(checkQuery, [id]);
        if (!existing.length) return { status: false, data: [], message: "Indent not found" };

        const { indent_no, requested_by, status, required_by, priority, notes, items } = body;

        if (requested_by) {
            const userCheck = await sqlQueryFun(`SELECT * FROM users WHERE id = $1`, [requested_by]);
            if (!userCheck.length) return { status: false, data: [], message: "Requested user not found" };
        }

        const fields = [];
        const values = [];
        let idx = 1;

        if (indent_no) { fields.push(`indent_no = $${idx++}`); values.push(indent_no); }
        if (requested_by) { fields.push(`requested_by = $${idx++}`); values.push(requested_by); }
        if (status) { fields.push(`status = $${idx++}`); values.push(status); }
        if (required_by) { fields.push(`required_by = $${idx++}`); values.push(required_by); }
        if (priority) { fields.push(`priority = $${idx++}`); values.push(priority); }
        if (notes) { fields.push(`notes = $${idx++}`); values.push(notes); }

        if (fields.length === 0) return { status: false, data: [], message: "No fields to update" };

        values.push(id);

        const updateQuery = `UPDATE indents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;

        const result = await sqlQueryFun(updateQuery, values);

        return { status: true, data: result, message: "Indent updated successfully" };

    } catch (error) {
        return { status: false, data: [], message: error.message }
    }
}

exports.updateIndentService = async (body, id) => {
  try {
    if (!id) return { status: false, data: [], message: "Indent ID is required" };

    const checkQuery = `SELECT * FROM indents WHERE id = $1`;
    const existing = await sqlQueryFun(checkQuery, [id]);
    if (!existing.length) return { status: false, data: [], message: "Indent not found" };

    const { indent_no, requested_by, status, required_by, priority, notes, items } = body;

    if (requested_by) {
      const userCheck = await sqlQueryFun(`SELECT * FROM users WHERE id = $1`, [requested_by]);
      if (!userCheck.length) return { status: false, data: [], message: "Requested user not found" };
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (indent_no !== undefined) { fields.push(`indent_no = $${idx++}`); values.push(indent_no); }
    if (requested_by !== undefined) { fields.push(`requested_by = $${idx++}`); values.push(requested_by); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (required_by !== undefined) { fields.push(`required_by = $${idx++}`); values.push(required_by); }
    if (priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(priority); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

    let updatedIndent = existing[0];
    if (fields.length) {
      values.push(id);
      const updateQuery = `UPDATE indents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
      const [res] = await sqlQueryFun(updateQuery, values);
      updatedIndent = res;
    }

    if (Array.isArray(items)) {
      const currentItems = await sqlQueryFun(`SELECT id FROM indent_items WHERE indent_id = $1`, [id]);
      const currentIds = new Set(currentItems.map(r => r.id));
      const incomingIds = new Set();

      for (const item of items) {
        const { id: itemId, raw_material_id, qty, uom, notes: itemNotes } = item;

        if (!itemId && (!raw_material_id || !qty || !uom)) {
          return {
            status: false,
            data: [],
            message: "New items must include raw_material_id, qty, and uom"
          };
        }

        if (itemId) {
          incomingIds.add(itemId);
          const updateFields = [];
          const updateValues = [];
          let paramIdx = 1;

          if (raw_material_id !== undefined) { updateFields.push(`raw_material_id = $${paramIdx++}`); updateValues.push(raw_material_id); }
          if (qty !== undefined) { updateFields.push(`qty = $${paramIdx++}`); updateValues.push(qty); }
          if (uom !== undefined) { updateFields.push(`uom = $${paramIdx++}`); updateValues.push(uom); }
          if (itemNotes !== undefined) { updateFields.push(`notes = $${paramIdx++}`); updateValues.push(itemNotes); }

          if (updateFields.length > 0) {
            updateValues.push(itemId, id);
            await sqlQueryFun(
              `UPDATE indent_items SET ${updateFields.join(', ')} WHERE id = $${paramIdx++} AND indent_id = $${paramIdx}`,
              updateValues
            );
          }
        } else {
          await sqlQueryFun(
            `INSERT INTO indent_items (indent_id, raw_material_id, qty, uom, notes)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, raw_material_id, qty, uom, itemNotes || null]
          );
        }
      }

      for (const oldId of currentIds) {
        if (!incomingIds.has(oldId)) {
          await sqlQueryFun(`DELETE FROM indent_items WHERE id = $1`, [oldId]);
        }
      }
    }

    return { status: true, data: updatedIndent, message: "Indent & items updated successfully" };

  } catch (error) {
    return { status: false, data: [], message: error.message };
  }
};


