// CREATE TABLE IF NOT EXISTS manufacture_articles (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   article_name TEXT NOT NULL,
//   remarks TEXT,
//   created_at TIMESTAMP DEFAULT NOW(),
//   updated_at TIMESTAMP DEFAULT NOW()
// );

const { pool } = require("../config/database")

exports.createManufactureArticleService = async (body, userId) => {
  const client = await pool.connect();
  const { article_name, remarks } = body;

  try {
    await client.query("BEGIN");

    // 🔹 Basic validations
    if (!article_name || article_name.trim() === "") {
      return { status: false, message: "Article name is required" };
    }

    // 🔹 Check if same article name already exists (case-insensitive)
    const checkQry = `
      SELECT id FROM manufacture_articles 
      WHERE LOWER(article_name) = LOWER($1)
      LIMIT 1;
    `;
    const checkRes = await client.query(checkQry, [article_name]);

    if (checkRes.rows.length > 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Article with the same name already exists" };
    }

    // 🔹 Insert new article
    const insertQry = `
      INSERT INTO manufacture_articles (
        article_name, remarks, created_by, updated_by
      ) VALUES ($1, $2, $3, $3)
      RETURNING *;
    `;
    const insertRes = await client.query(insertQry, [
      article_name.trim(),
      remarks || null,
      userId,
    ]);

    await client.query("COMMIT");

    return {
      status: true,
      message: "Manufacture article created successfully",
      data: insertRes.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error in createManufactureArticleService:", error);
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};

exports.getAllManufactureArticleService = async (query) => {
  const client = await pool.connect();
  try {
    // Extract query parameters
    let {
      page = 1,
      limit = 10,
      sortColumn = "created_at",
      sortOrder = "DESC",
      search = "",
      created_by = null, // optional filter
    } = query;

    const isAll = String(limit).toLowerCase() === "all";
    if (!isAll) limit = Number(limit);

    const offset = (page - 1) * (isAll ? 0 : limit);

    // ✅ Base filter
    let filterConditions = [];
    let filterValues = [];
    let paramIndex = 1;

    if (search) {
      filterConditions.push(
        `(LOWER(article_name) LIKE LOWER($${paramIndex}) OR LOWER(remarks) LIKE LOWER($${paramIndex}))`
      );
      filterValues.push(`%${search}%`);
      paramIndex++;
    }

    if (created_by) {
      filterConditions.push(`created_by = $${paramIndex}`);
      filterValues.push(created_by);
      paramIndex++;
    }

    const whereClause = filterConditions.length ? `WHERE ${filterConditions.join(" AND ")}` : "";

    // ✅ Count query for total records
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM manufacture_articles
      ${whereClause};
    `;
    const countResult = await client.query(countQuery, filterValues);
    const total = Number(countResult.rows[0]?.total || 0);

    // ✅ Data query (handle limit = all)
    let dataQuery = `
      SELECT 
        id,
        article_name,
        remarks,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM manufacture_articles
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
    `;

    let dataValues = [...filterValues];

    if (!isAll) {
      dataQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      dataValues.push(limit, offset);
    }

    const dataResult = await client.query(dataQuery, dataValues);

    const totalPages = isAll ? 1 : Math.ceil(total / limit);

    // ✅ Final response
    return {
      status: true,
      message: "Manufacture articles fetched successfully",
      data: {
        data: dataResult.rows.map((item) => ({
          ...item,
          total_records: total,
        })),
        pagination: {
          total_records: total,
          page: isAll ? 1 : Number(page),
          limit: isAll ? "all" : Number(limit),
          totalPages,
        },
      },
    };
  } catch (error) {
    console.error("❌ Error in getAllManufactureArticleService:", error);
    return { status: false, message: `Something went wrong (${error.message})` };
  } finally {
    client.release();
  }
};

exports.updateManufactureArticleService = async (id, body, userId) => {
  const client = await pool.connect();
  try {
    if (!body || Object.keys(body).length === 0) {
      return { status: false, message: "No fields provided for update." };
    }

    await client.query("BEGIN");

    // ✅ Check if record exists
    const checkExist = await client.query(
      `SELECT * FROM manufacture_articles WHERE id = $1`,
      [id]
    );
    if (checkExist.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Article not found." };
    }

    const existing = checkExist.rows[0];
    const fields = [];
    const values = [];
    let paramIndex = 1;
    let isChanged = false;

    // ✅ Handle article_name (with duplicate check)
    if (body.article_name && body.article_name.trim() !== existing.article_name) {
      const articleName = body.article_name.trim();

      // Check for duplicates
      const duplicateCheck = await client.query(
        `SELECT id FROM manufacture_articles 
         WHERE LOWER(article_name) = LOWER($1) AND id <> $2`,
        [articleName, id]
      );
      if (duplicateCheck.rowCount > 0) {
        await client.query("ROLLBACK");
        return { status: false, message: "Article name already exists." };
      }

      fields.push(`article_name = $${paramIndex}`);
      values.push(articleName);
      paramIndex++;
      isChanged = true;
    }

    // ✅ Handle remarks
    if (body.remarks !== undefined && body.remarks !== existing.remarks) {
      fields.push(`remarks = $${paramIndex}`);
      values.push(body.remarks || null);
      paramIndex++;
      isChanged = true;
    }

    // ❌ If no change detected → skip update
    if (!isChanged) {
      await client.query("ROLLBACK");
      return {
        status: true,
        message: "No changes detected — record remains unchanged.",
      };
    }

    // ✅ Add audit fields only when something changes
    fields.push(`updated_by = $${paramIndex}`);
    values.push(userId);
    paramIndex++;

    fields.push(`updated_at = NOW()`);

    // ✅ Final update query
    const updateQuery = `
      UPDATE manufacture_articles
      SET ${fields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *;
    `;
    values.push(id);

    const updateResult = await client.query(updateQuery, values);
    await client.query("COMMIT");

    return {
      status: true,
      message: "Manufacture article updated successfully.",
      data: updateResult.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error in updateManufactureArticleService:", error);
    return { status: false, message: `Failed to update article. (${error.message})` };
  } finally {
    client.release();
  }
};

exports.deleteManufactureArticleService = async (id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ✅ Check if article exists
    const checkExist = await client.query(
      `SELECT * FROM manufacture_articles WHERE id = $1`,
      [id]
    );
    if (checkExist.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: false, message: "Article not found." };
    }

    // ✅ Delete the record
    const deleteResult = await client.query(
      `DELETE FROM manufacture_articles WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query("COMMIT");

    return {
      status: true,
      message: "Manufacture article deleted successfully.",
      data: deleteResult.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error in deleteManufactureArticleService:", error);
    return { status: false, message: `Failed to delete article. (${error.message})` };
  } finally {
    client.release();
  }
};

exports.getManufactureArticleServiceById = async (id) => {
    console.log("<><>id",id);
    
  const client = await pool.connect();
  try {
    // ✅ Validate input
    if (!id) {
      return { status: false, message: "Article ID is required.", data: null };
    }

    // ✅ Fetch article by ID
    const query = `
      SELECT 
        id,
        article_name,
        remarks,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM manufacture_articles
      WHERE id = $1
      LIMIT 1;
    `;
    const result = await client.query(query, [id]);

    // ✅ Check if found
    if (result.rowCount === 0) {
      return { status: false, message: "Article not found.", data: null };
    }

    return {
      status: true,
      message: "Manufacture article fetched successfully.",
      data: result.rows[0],
    };
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
