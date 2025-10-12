const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction");
const { createAuditLog } = require("./auditlog.services");

exports.createBatchService = async (body, userId) => {
    const client = await pool.connect()
    try {
        const { batch_no, product_id, start_date, end_date, status, notes } = body;
        await client.query("BEGIN")
        if (!userId) return { status: false, message: "User ID is required." };
        if (!batch_no) return { status: false, message: "Batch number is required." };
        const product_exist = await sqlQueryFun(`SELECT * FROM products WHERE id = $1`, [product_id])
        if (!product_exist.length) {
            await client.query("ROLLBACK")
            return { status: false, message: "Product not found. Please verify if the product already exists" }
        }

        const batch_exist = await sqlQueryFun(`SELECT * FROM batches WHERE batch_no = $1`, [batch_no])
        if (batch_exist.length) {
            await client.query("ROLLBACK")
            return { status: false, message: `Batch number ${batch_no} already exist` }
        }


        const productUsed = await sqlQueryFun(`SELECT * FROM batches WHERE product_id = $1`, [product_id]);
        if (productUsed.length) {
            await client.query("ROLLBACK")
            return { status: false, message: "This product is already assigned to another batch. Cannot create batch." };
        }

        if (start_date && isNaN(Date.parse(start_date))) {
            return { status: false, message: "Invalid start_date format." };
        }
        if (end_date && isNaN(Date.parse(end_date))) {
            return { status: false, message: "Invalid end_date format." };
        }
        const validStatuses = ["planned", "in_progress", "completed", "QC"];
        if (status && !validStatuses.includes(status)) {
            return {
                status: false,
                message: `Invalid status. Allowed values: ${validStatuses.join(", ")}.`,
            };
        }

        const checkQuery = `SELECT 1 FROM batches WHERE batch_no = $1`;
        const existing = await sqlQueryFun(checkQuery, [batch_no]);
        if (existing > 0) {
            await client.query("ROLLBACK")
            return { status: false, message: `Batch number '${batch_no}' already exists.` };
        }

        // --- Insert new batch ---
        const insertQuery = `
      INSERT INTO batches (batch_no, product_id, created_by, start_date, end_date, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
        const result = await sqlQueryFun(insertQuery, [
            batch_no,
            product_id || null,
            userId,
            start_date || null,
            end_date || null,
            status || "planned",
            notes || null,
        ]);

        console.log("<><>result[0].id", result[0].id)
        console.log("<><>result[0].batch_no", result[0].batch_no)
        console.log("<><>product_exist[0].product_name", product_exist[0].product_name)
        console.log("<><>userId", userId)

        const logData = await createAuditLog(client, {
            entityType: 'batches',
            entityId: result[0].id,
            action: 'create',
            userId,
            details: {
                product_name: result[0].batch_no,
                product_code: product_exist[0].product_name
            },
            status: 'success',
            metadata: { message: `Batch No ${result[0].batch_no} created successfully` }
        });
        console.log("<><>logData", logData)
        await client.query("COMMIT");
        return {
            status: true,
            message: "Batch created successfully.",
            data: result[0],
        };
    } catch (error) {
        console.log("<><>error", error)
        await client.query("ROLLBACK")
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.getAllBatchService = async (queryParams) => {
    try {
        let {
            page = 1,
            limit = 10,
            search = "",
            sortBy = "created_at",
            order = "desc",
            status,
            start_date,
            end_date
        } = queryParams;

        page = parseInt(page);
        order = order.toLowerCase() === "asc" ? "asc" : "desc";

        const filters = [];
        const values = [];
        let idx = 1;

        // 🔍 Search
        if (search) {
            filters.push(`(pb.batch_no ILIKE $${idx} OR pb.notes ILIKE $${idx})`);
            values.push(`%${search}%`);
            idx++;
        }

        // 🔘 Status
        if (status) {
            filters.push(`pb.status = $${idx}`);
            values.push(status);
            idx++;
        }

        // 📅 Date range
        if (start_date) {
            filters.push(`pb.start_date >= $${idx}`);
            values.push(start_date);
            idx++;
        }
        if (end_date) {
            filters.push(`pb.end_date <= $${idx}`);
            values.push(end_date);
            idx++;
        }

        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        // 🟢 If limit = all → return all data
        if (limit === "all") {
            const query = `
        SELECT pb.*, p.product_name,p.product_code AS product_code
        FROM batches pb
        LEFT JOIN products p ON pb.product_id = p.id
        ${whereClause}
        ORDER BY ${sortBy} ${order}
      `;

            // ✅ Pass values only if there are filters
            const result = await sqlQueryFun(query, values.length ? values : []);

            return {
                status: true,
                data: { result, total: result.length },
                message: "All batches fetched successfully.",
            };
        }

        // 🟡 Paginated query
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        values.push(limit, offset);

        const query = `
      SELECT pb.*, p.product_name,p.product_code AS product_code
      FROM batches pb
      LEFT JOIN products p ON pb.product_id = p.id
      ${whereClause}
      ORDER BY ${sortBy} ${order}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

        const result = await sqlQueryFun(query, values);

        // 🧮 Count query (use same filters)
        const countQuery = `
      SELECT COUNT(*) AS total
      FROM batches pb
      LEFT JOIN products p ON pb.product_id = p.id
      ${whereClause}
    `;

        const countResult = await sqlQueryFun(countQuery, values.slice(0, idx - 1));
        const total = parseInt(countResult[0]?.total || 0);

        return { status: true, data: { result, total, page, totalPages: Math.ceil(total / limit) }, message: "Batches fetched successfully." };

    } catch (error) {
        return { status: false, message: `Something went wrong (${error.message})` };
    }
};

exports.updateBatchService = async (id, body,userId) => {
     const client = await pool.connect()
    try {
        const { batch_no, product_id, start_date, end_date, status, notes } = body;
        if (!id) return { status: false, message: "Batch ID is required." };
        if (product_id) {
            const product_exist = await sqlQueryFun(`SELECT * FROM products WHERE id = $1`, [product_id])
            if (!product_exist.length) return { status: false, message: "The selected product was not found. Please choose a valid product to continue; otherwise, you may encounter an error." }
        }
        // --- Validate status ---
        const validStatuses = ["planned", "in_progress", "completed", "QC"];
        if (status && !validStatuses.includes(status)) {
            return {
                status: false,
                message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
            };
        }

        // --- Validate dates ---
        if (start_date && isNaN(Date.parse(start_date))) {
            return { status: false, message: "Invalid start_date format." };
        }
        if (end_date && isNaN(Date.parse(end_date))) {
            return { status: false, message: "Invalid end_date format." };
        }

        // --- Check for duplicate batch number ---
        if (batch_no) {
            const checkQuery = `SELECT id FROM batches WHERE batch_no = $1 AND id != $2`;
            const checkResult = await sqlQueryFun(checkQuery, [batch_no, id]);
            if (checkResult.length > 0) {
                return { status: false, message: "Batch number already exists." };
            }
        }

        // --- Update query ---
        const query = `
      UPDATE batches
      SET
        batch_no = COALESCE($1, batch_no),
        product_id = COALESCE($2, product_id),
        start_date = COALESCE($3, start_date),
        end_date = COALESCE($4, end_date),
        status = COALESCE($5, status),
        notes = COALESCE($6, notes)
      WHERE id = $7
      RETURNING *
    `;
        const values = [batch_no, product_id, start_date, end_date, status, notes, id];
        const result = await sqlQueryFun(query, values);

        if (!result.length) return { status: false, message: "Batch not found." };

           await createAuditLog(client, {
              entityType: 'batches',
              entityId: result[0].id,
              action: 'update',
              userId,
              details: {
                product_name: result[0].batch_no,
                product_code: "There is no product"
              },
              status: 'success',
              metadata: { message: `Batch No ${result[0].batch_no} updated successfully` }
            });
        return {
            status: true,
            data: result[0],
            message: "Batch updated successfully.",
        };
    } catch (error) {
        return { status: false, message: `Something went wrong (${error.message})` };
    }
};

exports.deleteBatchService = async (id,userId) => {
    const client = await pool.connect()
    try {
        const query = `DELETE FROM batches WHERE id = $1 RETURNING *`;
        const result = await sqlQueryFun(query, [id]);
        if (!result.length) return { status: false, message: "Batch not found." }
         await createAuditLog(client, {
            entityType: 'batches',
            entityId: result[0].id,
            action: 'delete',
            userId,
            details: {
                product_name: result[0].batch_no,
                product_code: "There is no product"
            },
            status: 'success',
            metadata: { message: `Batch No ${result[0].batch_no} created successfully` }
        });
        return {
            status: true,
            data: result,
            message: "Batch deleted successfully.",
        };
    } catch (error) {
        return { status: false, message: `Something went wrong (${error.message})` };
    }
};
