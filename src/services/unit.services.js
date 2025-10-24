const { pool } = require("../config/database");

// unit_name chair unit
// department_name : Manufactory Store Keeper
// purpose : For Raw Material
// shop_name : Yard & Work-Shop
// product_name : SOAP OIL, FLOOR CLEANER
// items=[]
exports.createUnitMaster = async (userId, body) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { unit_name, department_name, purpose, shop_name, product_name, items } = body;
        const unit_nameExist = await client.query(`SELECT * FROM unit_master WHERE unit_name ILIKE $1`, [unit_name])
        if (unit_nameExist.length) return { status: false, message: `Already exist ${unit_name} unit` }

        const insertMasterQuery = `
      INSERT INTO unit_master (unit_name, department_name, purpose, shop_name, product_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
        const result = await client.query(insertMasterQuery, [
            unit_name,
            department_name,
            purpose,
            shop_name,
            product_name
        ]);
        const unitMasterId = result.rows[0].id;

        if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                await client.query(
                    `INSERT INTO unit_master_items (unit_master_id, raw_material_id, weight, unit, rate)
                    VALUES ($1, $2, $3, $4, $5);`,
                    [unitMasterId, item.raw_material_id, item.weight, item.unit, item.rate]
                );
            }
        }

        const data = await client.query('COMMIT');
        return { status: true,data, message: "Unit master created successfully" };
    } catch (error) {
        await client.query('ROLLBACK');
        return { status: false, message: `Something went wrong. (${error.message})` };
    } finally {
        client.release();
    }
}

exports.getUnitMaster = async (query) => {
    const client = await pool.connect();
    try {
        const { search = "", sort_by = "created_at", sort_order = "desc", page = 1, limit = 10, unit_id } = query;
        await client.query('BEGIN');

        let whereClauses = [];
        let values = [];
        let queryIndex = 1;

        if (search) {
            whereClauses.push(`(
        unit_name ILIKE $${queryIndex} OR
        department_name ILIKE $${queryIndex} OR
        purpose ILIKE $${queryIndex} OR
        shop_name ILIKE $${queryIndex} OR
        product_name ILIKE $${queryIndex}
      )`);
            values.push(`%${search}%`);
            queryIndex++;
        }

        // 🔸 If filtering by specific unit_id
        if (unit_id) {
            whereClauses.push(`id = $${queryIndex}`);
            values.push(unit_id);
            queryIndex++;
        }

        // 🔸 Build WHERE clause
        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        // 🔸 Sorting and pagination setup
        const orderBy = `ORDER BY ${sort_by} ${sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC"}`;

        let limitClause = "";
        if (limit !== "all") {
            const offset = (page - 1) * parseInt(limit);
            limitClause = `LIMIT ${parseInt(limit)} OFFSET ${offset}`;
        }

        // 🔹 Count query (for pagination info)
        const countQuery = `SELECT COUNT(*) FROM unit_master ${whereClause}`;
        const countResult = await client.query(countQuery, values);
        const totalRecords = parseInt(countResult.rows[0].count);

        // 🔹 Fetch main records
        const dataQuery = `
      SELECT *
      FROM unit_master
      ${whereClause}
      ${orderBy}
      ${limitClause};
    `;
        const masterResult = await client.query(dataQuery, values);
        const units = masterResult.rows;

        // 🔹 Fetch related items for each unit
        for (const unit of units) {
            const itemsResult = await client.query(
                `SELECT umi.*, rm.name AS raw_material_name, rm.uom, rm.code
         FROM unit_master_items umi
         LEFT JOIN raw_materials rm ON umi.raw_material_id = rm.id
         WHERE umi.unit_master_id = $1
         ORDER BY umi.created_at DESC`,
                [unit.id]
            );
            unit.items = itemsResult.rows;
        }

        // ✅ Final response
        return {
            status: true,
            totalRecords,
            totalPages: limit === "all" ? 1 : Math.ceil(totalRecords / parseInt(limit)),
            currentPage: limit === "all" ? 1 : parseInt(page),
            data: units,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        return { status: false, message: `Something went wrong. (${error.message})` };
    } finally {
        client.release();
    }
}

exports.deleteUnitMaster = async (unit_id) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!unit_id) {
            return { status: false, message: "Unit ID is required" };
        }

        // Check if record exists
        const check = await client.query(`SELECT id FROM unit_master WHERE id = $1`, [unit_id]);
        if (check.rows.length === 0) {
            return { status: false, message: "Unit master not found" };
        }

        // Delete from unit_master (unit_master_items will auto-delete due to ON DELETE CASCADE)
        await client.query(`DELETE FROM unit_master WHERE id = $1`, [unit_id]);

        await client.query('COMMIT');
        return { status: true, message: "Unit master and related items deleted successfully" };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error deleting unit master:", error);
        return { status: false, message: `Something went wrong. (${error.message})` };
    } finally {
        client.release();
    }
};

exports.updateUnitMaster = async (unit_id, body, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { unit_name, department_name, purpose, shop_name, product_name, items } = body;

    if (!unit_id) {
      return { status: false, message: "Unit ID is required" };
    }

    // 🔹 Check if unit exists
    const existingUnit = await client.query(`SELECT * FROM unit_master WHERE id = $1`, [unit_id]);
    if (existingUnit.rows.length === 0) {
      return { status: false, message: "Unit master not found" };
    }

    // 🔹 Build update query dynamically
    const fields = { unit_name, department_name, purpose, shop_name, product_name };
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    // Add updated_by and updated_at
    setClauses.push(`updated_by = $${idx}`);
    values.push(userId);
    idx++;

    setClauses.push(`updated_at = now()`);

    if (setClauses.length > 0) {
      const updateQuery = `
        UPDATE unit_master
        SET ${setClauses.join(", ")}
        WHERE id = $${idx}
      `;
      values.push(unit_id);
      await client.query(updateQuery, values);
    }

    // 🔹 Handle unit_master_items (if provided)
    if (Array.isArray(items)) {
      const existingItems = await client.query(
        `SELECT id, raw_material_id FROM unit_master_items WHERE unit_master_id = $1`,
        [unit_id]
      );

      const existingMap = new Map(existingItems.rows.map(item => [item.raw_material_id, item.id]));
      const inputRawIds = items.map(i => i.raw_material_id);

      for (const item of items) {
        const value = (item.weight || 0) * (item.rate || 0); // auto-calculate

        if (!existingMap.has(item.raw_material_id)) {
          // Insert new item
          await client.query(
            `INSERT INTO unit_master_items 
              (unit_master_id, raw_material_id, weight, unit, rate, value, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [unit_id, item.raw_material_id, item.weight || 0, item.unit || null, item.rate || 0, value]
          );
        } else {
          // Dynamic update for provided fields
          const updateItemFields = [];
          const updateValues = [];
          let j = 1;

          if (item.weight !== undefined) {
            updateItemFields.push(`weight = $${j++}`);
            updateValues.push(item.weight);
          }
          if (item.unit !== undefined) {
            updateItemFields.push(`unit = $${j++}`);
            updateValues.push(item.unit);
          }
          if (item.rate !== undefined) {
            updateItemFields.push(`rate = $${j++}`);
            updateValues.push(item.rate);
          }

          // always update value if weight/rate is changed
          if (item.weight !== undefined || item.rate !== undefined) {
            updateItemFields.push(`value = $${j++}`);
            updateValues.push(value);
          }

          // add updated_at timestamp
          updateItemFields.push(`updated_at = now()`);

          if (updateItemFields.length > 0) {
            const updateItemQuery = `
              UPDATE unit_master_items
              SET ${updateItemFields.join(", ")}
              WHERE unit_master_id = $${j} AND raw_material_id = $${j + 1}
            `;
            updateValues.push(unit_id, item.raw_material_id);
            await client.query(updateItemQuery, updateValues);
          }
        }
      }

      // Delete items not in payload
      const rawIdsToDelete = existingItems.rows
        .filter(item => !inputRawIds.includes(item.raw_material_id))
        .map(item => item.raw_material_id);

      if (rawIdsToDelete.length > 0) {
        await client.query(
          `DELETE FROM unit_master_items
           WHERE unit_master_id = $1 AND raw_material_id = ANY($2::uuid[])`,
          [unit_id, rawIdsToDelete]
        );
      }
    }

    await client.query("COMMIT");
    return { status: true, message: "Unit master updated successfully" };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating unit master:", error);
    return { status: false, message: `Something went wrong. (${error.message})` };
  } finally {
    client.release();
  }
};



