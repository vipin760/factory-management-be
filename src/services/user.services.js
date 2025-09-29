const { sqlQueryFun } = require("../database/sql/sqlFunction");
const bcrypt = require('bcrypt')

exports.createUserService = async (body) => {
  try {
    const { name,email, role="user" } = body;
    if(!name) return { status:false, message:"name field required"}
    if(!email) return { status:false, message:"email field required"}
    password_hash = await bcrypt.hash(body.password,10)
    const [existUser] = await sqlQueryFun(`SELECT * FROM users WHERE email=$1`,[email]);
    if (existUser) {
      return { status: false,message: `The email (${email}) is already registered. Please use a different email.`};
    }
    const insertQry = `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`;
    const result = await sqlQueryFun(insertQry, [name, email, password_hash, role]);
    return { status: true, data: result[0], message: "User created successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

exports.updateUserService1 = async (id, body) => {
  try {
    const { name, role } = body;
    let result
    if(body.password){
        let password_hash = await bcrypt.hash(body.password,10)
         const updateQry = `
      UPDATE users
      SET name=$1, password_hash=$2, role=$3
      WHERE id=$4
      RETURNING *
    `;
     result = await sqlQueryFun(updateQry, [name, password_hash, role, id]);
    }else{
         const updateQry = `
      UPDATE users
      SET name=$1, role=$2
      WHERE id=$3
      RETURNING *
    `;
     result = await sqlQueryFun(updateQry, [name, role, id]);
    }
   
    if (!result.length) return { status: false, message: "User not found." };
    return { status: true, data: result[0], message: "User updated successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

exports.updateUserService = async (id, body) => {
  try {
    const { name, email, role, password } = body;

    const fields = [];
    const values = [];
    let index = 1;

    if (name) {
      fields.push(`name=$${index++}`);
      values.push(name);
    }
    if (email) {
      fields.push(`email=$${index++}`);
      values.push(email);
    }
    if (role) {
      fields.push(`role=$${index++}`);
      values.push(role);
    }
    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash=$${index++}`);
      values.push(password_hash);
    }

    if (fields.length === 0) {
      return { status: false, message: "No valid fields to update." };
    }

    // Add id for WHERE clause
    values.push(id);

    const updateQry = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id=$${index}
      RETURNING *
    `;

    const result = await sqlQueryFun(updateQry, values);

    if (!result.length) {
      return { status: false, message: "User not found or no changes applied." };
    }

    return {
      status: true,
      data: result[0],
      message: "User updated successfully.",
    };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

exports.deleteUserService = async (id) => {
  try {
    const deleteQry = `DELETE FROM users WHERE id=$1 RETURNING *`;
    const result = await sqlQueryFun(deleteQry, [id]);
    if (!result.length) return { status: false, message: "User not found." };
    return { status: true, data: result[0], message: "User deleted successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

exports.getUserByIdService = async (id) => {
  try {
    const query = `SELECT * FROM users WHERE id=$1`;
    const [result] = await sqlQueryFun(query, [id]);

    if (!result) return { status: false, message: "User not found." };

    return { status: true, data: result };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

exports.getAllUsersService = async (query) => {
  try {
    let { search, role, sortBy = "created_at", sortOrder = "DESC", limit, page } = query;
    let offset = 0;
    const values = [];
    let whereClause = "";

    // Search by name or email
    if (search) {
      values.push(`%${search}%`);
      whereClause += `name ILIKE $${values.length} OR email ILIKE $${values.length} `;
    }

    // Filter by role
    if (role) {
      values.push(role);
      whereClause += whereClause ? `AND role=$${values.length} ` : `role=$${values.length} `;
    }

    whereClause = whereClause ? `WHERE ${whereClause}` : "";

    // Pagination
    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;
    if (limit) offset = (page - 1) * limit;
    const paginationClause =
      limit ? `LIMIT $${values.length + 1} OFFSET $${values.length + 2}` : "";
    if (limit) values.push(limit, offset);

    // Fetch users
    const queryStr = `
      SELECT * FROM users
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      ${paginationClause}
    `;
    const response = await sqlQueryFun(queryStr, values);

    // Total count
    const countQuery = `SELECT COUNT(*) AS total FROM users ${whereClause}`;
    const [countResult] = await sqlQueryFun(
      countQuery,
      values.slice(0, values.length - (limit ? 2 : 0))
    );
    const total = parseInt(countResult.total);

    // Construct final result
    const result = {
      response,
      total,
      page: limit ? page : 1,
      limit: limit || total,
    };

    return {
      status: true,
      data: result,
      message: "Users fetched successfully.",
    };
  } catch (error) {
    return { status: false, message: `Something went wrong. (${error.message})` };
  }
};

