const { pool } = require("../config/database")

exports.createTransitRegisterService = async (body) => {
    const client = await pool.connect();
    try {
        const {
            manufacture_articles_id,
            transit_date,
            production_name,
            indent_id,
            quantity,
            unit,
            store_keeper_approval = false,
            jailor_approval = false,
            superintendent_approval = false,
        } = body;

        // ✅ 1. Basic field validations
        if (!manufacture_articles_id) {
            return { status: false, message: "Manufacture article ID is required." };
        }

        if (!transit_date) {
            return { status: false, message: "Transit date is required." };
        }

        // ✅ Validate date
        if (isNaN(new Date(transit_date))) {
            return { status: false, message: "Invalid date format." };
        }

        // ✅ Validate numeric quantity
        if (quantity === undefined || isNaN(quantity) || quantity <= 0) {
            return { status: false, message: "Quantity must be a positive number." };
        }

        // ✅ Either production_name or indent_id must exist
        if (!production_name?.trim() && !indent_id?.trim()) {
            return {
                status: false,
                message: "Either 'production_name' or 'indent_id' must be provided.",
            };
        }

        const indentDataExist = await client.query(`SELECT * FROM indents WHERE id =$1`, [indent_id]);
        if (!indentDataExist.rows.length)
            return { status: false, message: "Indent ID doesn't exist." };

        const availableQty = parseFloat(indentDataExist.rows[0].quantity);
        const enteredQty = parseFloat(quantity);

        if (enteredQty > availableQty) {
            return {
                status: false,
                message: `Insufficient quantity. Available: ${availableQty}, but you entered ${enteredQty}. Please enter a value less than or equal to the available quantity.`,
            };
        }

        // ✅ Unit validation
        const allowedUnits = ["kg", "litre", "piece", "meter", "pack"];
        if (unit && !allowedUnits.includes(unit.toLowerCase())) {
            return {
                status: false,
                message: `Invalid unit. Allowed values: ${allowedUnits.join(", ")}`,
            };
        }

        await client.query("BEGIN");

        // ✅ 2. Check if linked manufacture article exists
        const articleExists = await client.query(
            `SELECT id FROM manufacture_articles WHERE id = $1`,
            [manufacture_articles_id]
        );

        if (articleExists.rowCount === 0) {
            await client.query("ROLLBACK");
            return { status: false, message: "Invalid manufacture article ID." };
        }

        // ✅ 3. Prevent duplicate entries (same article, date, indent)
        const duplicateCheck = await client.query(
            `SELECT id FROM transit_register 
       WHERE manufacture_articles_id = $1 AND transit_date = $2 AND indent_id = $3`,
            [manufacture_articles_id, transit_date, indent_id || null]
        );

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            return {
                status: false,
                message:
                    "A transit record already exists for this article, date, and indent number.",
            };
        }

        // ✅ 4. Insert the new record
        const insertQuery = `
      INSERT INTO transit_register (
        manufacture_articles_id,
        transit_date,
        production_name,
        indent_id,
        quantity,
        unit,
        store_keeper_approval,
        jailor_approval,
        superintendent_approval,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING *;
    `;

        const insertValues = [
            manufacture_articles_id,
            transit_date,
            production_name?.trim() || null,
            indent_id?.trim() || null,
            quantity,
            unit?.toLowerCase() || null,
            !!store_keeper_approval,
            !!jailor_approval,
            !!superintendent_approval,
        ];

        const result = await client.query(insertQuery, insertValues);
        await client.query("COMMIT");

        return {
            status: true,
            message: "Transit record created successfully.",
            data: result.rows[0],
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error in createTransitRegisterService:", error);
        return {
            status: false,
            message: `Something went wrong (${error.message})`,
        };
    } finally {
        client.release();
    }
};


exports.getAllTransitRegisterService = async (query) => {
    const client = await pool.connect();
    try {
        const {
            search = "",
            sortBy = "created_at",
            sortOrder = "DESC",
            page = 1,
            limit = 10,
            start_date,
            end_date,
            store_keeper_approval,
            jailor_approval,
            superintendent_approval,
            manufacture_articles_id,
        } = query;

        // ✅ Base query
        let whereClauses = [];
        let values = [];
        let index = 1;

        // ✅ Search filter
        if (search) {
            whereClauses.push(
                `(LOWER(tr.production_name) LIKE LOWER($${index}) OR LOWER(tr.indent_no) LIKE LOWER($${index}))`
            );
            values.push(`%${search}%`);
            index++;
        }

        // ✅ Filter by manufacture_articles_id
        if (manufacture_articles_id) {
            whereClauses.push(`tr.manufacture_articles_id = $${index}`);
            values.push(manufacture_articles_id);
            index++;
        }

        // ✅ Filter by approvals
        if (store_keeper_approval !== undefined) {
            whereClauses.push(`tr.store_keeper_approval = $${index}`);
            values.push(store_keeper_approval === "true");
            index++;
        }

        if (jailor_approval !== undefined) {
            whereClauses.push(`tr.jailor_approval = $${index}`);
            values.push(jailor_approval === "true");
            index++;
        }

        if (superintendent_approval !== undefined) {
            whereClauses.push(`tr.superintendent_approval = $${index}`);
            values.push(superintendent_approval === "true");
            index++;
        }

        // ✅ Date range filter
        if (start_date && end_date) {
            whereClauses.push(`tr.transit_date BETWEEN $${index} AND $${index + 1}`);
            values.push(start_date, end_date);
            index += 2;
        }

        // ✅ Combine all WHERE conditions
        const whereQuery = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        // ✅ Sorting
        const validSortColumns = [
            "transit_date",
            "production_name",
            "indent_no",
            "quantity",
            "created_at",
        ];
        const orderColumn = validSortColumns.includes(sortBy) ? sortBy : "created_at";
        const orderDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

        // ✅ Pagination setup
        let paginationQuery = "";
        let limitValue = limit === "all" ? null : parseInt(limit);
        let offsetValue = (parseInt(page) - 1) * parseInt(limit);

        if (limitValue && limitValue > 0) {
            paginationQuery = `LIMIT ${limitValue} OFFSET ${offsetValue}`;
        }

        // ✅ Main query
        const dataQuery = `
      SELECT 
        tr.*, 
        ma.article_name,
        ma.remarks
      FROM transit_register tr
      LEFT JOIN manufacture_articles ma ON ma.id = tr.manufacture_articles_id
      ${whereQuery}
      ORDER BY ${orderColumn} ${orderDirection}
      ${paginationQuery};
    `;

        // ✅ Count query
        const countQuery = `
      SELECT COUNT(*) AS total_records
      FROM transit_register tr
      LEFT JOIN manufacture_articles ma ON ma.id = tr.manufacture_articles_id
      ${whereQuery};
    `;

        const [dataResult, countResult] = await Promise.all([
            client.query(dataQuery, values),
            client.query(countQuery, values),
        ]);

        const totalRecords = parseInt(countResult.rows[0]?.total_records || 0);
        const recordsData = dataResult.rows.map((items) => ({
            ...items, total_records: totalRecords
        }))
        const pagination =
            limit === "all"
                ? null
                : {
                    total_records: totalRecords,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(totalRecords / limitValue),
                    limit: limitValue,
                }
        return {
            status: true,
            message: "Transit register data fetched successfully",
            data: { data: recordsData, pagination }
            ,
        };
    } catch (error) {
        console.error("❌ Error in getAllTransitRegisterService:", error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};


exports.updateTransitRegisterService = async (id, body) => {
    const client = await pool.connect();
    try {
        const {
            manufacture_articles_id,
            transit_date,
            production_name,
            indent_no,
            quantity,
            unit,
            store_keeper_approval,
            jailor_approval,
            superintendent_approval,
        } = body;

        // ✅ Check required params
        if (!id) return { status: false, message: "Record ID is required." };

        await client.query("BEGIN");

        // ✅ Check if record exists
        const existing = await client.query(
            `SELECT * FROM transit_register WHERE id = $1`,
            [id]
        );
        if (existing.rowCount === 0) {
            await client.query("ROLLBACK");
            return { status: false, message: "Transit record not found." };
        }

        // ✅ Optional: validate manufacture_articles_id
        if (manufacture_articles_id) {
            const articleCheck = await client.query(
                `SELECT id FROM manufacture_articles WHERE id = $1`,
                [manufacture_articles_id]
            );
            if (articleCheck.rowCount === 0) {
                await client.query("ROLLBACK");
                return { status: false, message: "Invalid manufacture article ID." };
            }
        }

        // ✅ Validate date if provided
        if (transit_date && isNaN(new Date(transit_date))) {
            return { status: false, message: "Invalid date format." };
        }

        // ✅ Validate quantity if provided
        if (quantity !== undefined) {
            if (isNaN(quantity) || quantity <= 0) {
                return { status: false, message: "Quantity must be a positive number." };
            }
        }

        // ✅ Validate unit
        const allowedUnits = ["kg", "litre", "piece", "meter", "pack"];
        if (unit && !allowedUnits.includes(unit.toLowerCase())) {
            return {
                status: false,
                message: `Invalid unit. Allowed values: ${allowedUnits.join(", ")}`,
            };
        }

        // ✅ Either production_name or indent_no must exist (if both are empty/null)
        if (
            production_name !== undefined &&
            indent_no !== undefined &&
            !production_name?.trim() &&
            !indent_no?.trim()
        ) {
            return {
                status: false,
                message: "Either 'production_name' or 'indent_no' must be provided.",
            };
        }

        // ✅ Prevent duplicate: same article, date, indent_no (excluding current record)
        if (manufacture_articles_id && transit_date && indent_no) {
            const dupCheck = await client.query(
                `SELECT id FROM transit_register 
         WHERE manufacture_articles_id = $1 
         AND transit_date = $2 
         AND indent_no = $3 
         AND id <> $4`,
                [manufacture_articles_id, transit_date, indent_no, id]
            );
            if (dupCheck.rowCount > 0) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message:
                        "Another record already exists with same article, date, and indent number.",
                };
            }
        }

        // ✅ Dynamically build update query
        const fields = [];
        const values = [];
        let idx = 1;

        const addField = (column, value) => {
            fields.push(`${column} = $${idx}`);
            values.push(value);
            idx++;
        };

        if (manufacture_articles_id) addField("manufacture_articles_id", manufacture_articles_id);
        if (transit_date) addField("transit_date", transit_date);
        if (production_name !== undefined)
            addField("production_name", production_name?.trim() || null);
        if (indent_no !== undefined) addField("indent_no", indent_no?.trim() || null);
        if (quantity !== undefined) addField("quantity", quantity);
        if (unit !== undefined) addField("unit", unit?.toLowerCase() || null);
        if (store_keeper_approval !== undefined)
            addField("store_keeper_approval", !!store_keeper_approval);
        if (jailor_approval !== undefined)
            addField("jailor_approval", !!jailor_approval);
        if (superintendent_approval !== undefined)
            addField("superintendent_approval", !!superintendent_approval);

        // ✅ Update timestamp
        addField("updated_at", new Date());

        if (fields.length === 0) {
            return { status: false, message: "No valid fields provided for update." };
        }

        const updateQuery = `
      UPDATE transit_register
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;
        values.push(id);

        const updateResult = await client.query(updateQuery, values);

        await client.query("COMMIT");

        return {
            status: true,
            message: "Transit record updated successfully.",
            data: updateResult.rows[0],
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error in updateTransitRegisterService:", error);
        return {
            status: false,
            message: `Failed to update transit record. (${error.message})`,
        };
    } finally {
        client.release();
    }
};


exports.deleteTransitRegisterService = async (id) => {
    const client = await pool.connect();
    try {
        if (!id) {
            return { status: false, message: "Transit record ID is required." };
        }

        await client.query("BEGIN");

        // ✅ Check if record exists
        const checkExist = await client.query(
            `SELECT id FROM transit_register WHERE id = $1`,
            [id]
        );

        if (checkExist.rowCount === 0) {
            await client.query("ROLLBACK");
            return { status: false, message: "Transit record not found." };
        }

        // ✅ Delete the record
        await client.query(`DELETE FROM transit_register WHERE id = $1`, [id]);

        await client.query("COMMIT");

        return {
            status: true,
            message: "Transit record deleted successfully.",
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error in deleteTransitRegisterService:", error);
        return {
            status: false,
            message: `Failed to delete transit record. (${error.message})`,
        };
    } finally {
        client.release();
    }
};


exports.getTransitRegisterServiceById = async (id) => {
    console.log("<><>id", id);

    const client = await pool.connect();
    try {

    } catch (error) {
        console.error("❌ Error in getManufactureArticleServiceById:", error);
        return {
            status: false,
            data: null,
            message: error.message || "Something went wrong while fetching article.",
        };
    } finally {
        client.release();
    }
};
