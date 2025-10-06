const { sqlQueryFun } = require("../database/sql/sqlFunction");
const { validate: isUuid } = require('uuid');

exports.createProductService = async (body, userId) => {
  try {
    const { product_name, product_code, description } = body;
    if (!product_name) return { status: false, message: "Product name is required." };
     let checkQuery = `SELECT * FROM products WHERE product_code= $1`;
    let existing = await sqlQueryFun(checkQuery, [product_code]);
 
    if (existing.length > 0) {
      return {
        status: false,
        message: `product code '${product_code}' already exists.`,
      };
    }

     checkQuery = `SELECT * FROM products WHERE product_name= $1`;
     existing = await sqlQueryFun(checkQuery, [product_name]);
     const existingName = await sqlQueryFun(checkQuery, [product_name]);
 
    if (existingName.length > 0) {
      return {
        status: false,
        message: `product name '${product_name}' already exists.`,
      };
    }

    const query = `INSERT INTO products (product_name, product_code, description) VALUES ($1, $2, $3) RETURNING *`;
    const values = [product_name.toLowerCase(), product_code || null, description || null];
    const result = await sqlQueryFun(query, values);
    return { status: true, data: result[0], message: "Product created successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};

exports.getAllProductsService = async (queryParams) => {
  try {
    let { page = 1, limit = 10, search = '', sortBy = 'created_at', order = 'desc' } = queryParams;

    page = parseInt(page);
    order = order.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const values = [`%${search}%`];

    let query;
    let total;

    if (limit === 'all') {
      query = `
        SELECT *
        FROM products
        WHERE product_name ILIKE $1 OR product_code ILIKE $1
        ORDER BY ${sortBy} ${order}
      `;
      const result = await sqlQueryFun(query, values);
      total = result.rowCount;
      return {
        status: true,
        data: result.rows,
        total,
      };
    } else {
      limit = parseInt(limit);
      const offset = (page - 1) * limit;
      values.push(limit, offset);

      query = `
        SELECT *
        FROM products
        WHERE product_name ILIKE $1 OR product_code ILIKE $1
        ORDER BY ${sortBy} ${order}
        LIMIT $2 OFFSET $3
      `;
      const result = await sqlQueryFun(query, values);

      const countQuery = `
        SELECT COUNT(*)
        FROM products
        WHERE product_name ILIKE $1 OR product_code ILIKE $1
      `;
      const countResult = await sqlQueryFun(countQuery, [`%${search}%`]);
      total = parseInt(countResult[0].count);
 const data = {result,total,page}
      return {
        status: true,
        data,
        message:"all product fetched successfully"
      };
    }
  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};

exports.updateProductService = async (id, body) => {
  try {
    const { product_name, product_code, description } = body;
    if (product_code) {
      const checkQuery = `SELECT id FROM products WHERE product_code = $1 AND id != $2`;
      const checkResult = await sqlQueryFun(checkQuery, [product_code, id]);
      if (checkResult.length) {
        return { status: false, message: "Product code already exists." };
      }
    }

    const query = `UPDATE products SET product_name = COALESCE($1, product_name),product_code = COALESCE($2, product_code),description = COALESCE($3, description) WHERE id = $4 RETURNING *`;
    const values = [product_name, product_code, description, id];

    const result = await sqlQueryFun(query, values);

    if (!result.length) return { status: false, message: "Product not found." };

    return { status: true, data: result[0], message: "Product updated successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};

exports.deleteProductService = async (id) => {
  try {
    const query = `DELETE FROM products WHERE id = $1 RETURNING *`;
    const result = await sqlQueryFun(query, [id]);

    if (!result.length) return { status: false, message: "Product not found." };

    return { status: true,data:result[0], message: "Product deleted successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong (${error.message})` };
  }
};