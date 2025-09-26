const { sqlQueryFun } = require("../database/sql/sqlFunction");

exports.createVendorService = async (body) => {
    const { name, contactEmail, phone, gstin, address } = body;
    if (!name) return { status: false, message: "Vendor name is required." }
    const query = `INSERT INTO vendors (name, contact_email, phone, gstin, address) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [name, contactEmail || null, phone || null, gstin || null, address ? JSON.stringify(address) : null];
    try {
        const result = await sqlQueryFun(query, values)
        return { status: true, data: result, message: "Vendor has been successfully added" }
    } catch (error) {
        return { status: false, message: error.message }
    }
}

exports.getAllVendorService = async (queryParams) => {
    let { name, contactEmail, phone, gstin, address, page, limit, sortBy, sortOrder } = queryParams;

    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;

    sortBy = sortBy || 'created_at';
    sortOrder = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    let baseQuery = `SELECT * FROM vendors WHERE 1=1`;
    const values = [];
    let idx = 1;

    if (name) {
      baseQuery += ` AND name ILIKE $${idx}`;
      values.push(`%${name}%`);
      idx++;
    }
    if (contactEmail) {
      baseQuery += ` AND contact_email ILIKE $${idx}`;
      values.push(`%${contactEmail}%`);
      idx++;
    }
    if (phone) {
      baseQuery += ` AND phone ILIKE $${idx}`;
      values.push(`%${phone}%`);
      idx++;
    }
    if (gstin) {
      baseQuery += ` AND gstin ILIKE $${idx}`;
      values.push(`%${gstin}%`);
      idx++;
    }
    if (address) {
      baseQuery += ` AND address::TEXT ILIKE $${idx}`;
      values.push(`%${JSON.stringify(address).replace(/"/g, '')}%`);
      idx++;
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) AS sub`;
    const countResult = await sqlQueryFun(countQuery, values);
    const total = parseInt(countResult[0]?.total || 0);

    baseQuery += ` ORDER BY ${sortBy} ${sortOrder}`;
    if (limit) {
      const offset = (page - 1) * limit;
      baseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    try {
        const vendors = await sqlQueryFun(baseQuery, values);
        const data = { vendors,total,page,limit: limit || total}
        return { status: true, data: data, message: "Vendor has been fetched successfully" }
    } catch (error) {
        return { status: false, message: error.message }
    }
}

exports.updateVendorService = async (id, body) => {
    const { name, contactEmail, phone, gstin, address } = body;
    if (!id) return { status: false, message: "Vendor ID is required." };
    if (!name && !contactEmail && !phone && !gstin && !address) {
        return { status: false, message: "At least one field is required to update." };
    }
    const fields = [];
    const values = [];
    let idx = 1;

    if (name) {
        fields.push(`name = $${idx}`);
        values.push(name);
        idx++;
    }
    if (contactEmail) {
        fields.push(`contact_email = $${idx}`);
        values.push(contactEmail);
        idx++;
    }
    if (phone) {
        fields.push(`phone = $${idx}`);
        values.push(phone);
        idx++;
    }
    if (gstin) {
        fields.push(`gstin = $${idx}`);
        values.push(gstin);
        idx++;
    }
    if (address) {
        fields.push(`address = $${idx}`);
        values.push(JSON.stringify(address));
        idx++;
    }

    const query = `UPDATE vendors SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    values.push(id);
    try {
        const result = await sqlQueryFun(query, values);
        if (!result.length) {
            return { status: false, message: "Vendor not found." };
        }
        return { status: true, data: result[0], message: "Vendor has been updated successfully." };
    } catch (error) {
        return { status: false, message: error.message };
    }
};

exports.deleteVendorService = async (id) => {
    if (!id) return { status: false, message: "Vendor ID is required." };
    const query = `DELETE FROM vendors WHERE id = $1 RETURNING *`;
    const values = [id];
    try {
        const result = await sqlQueryFun(query, values);
        if (!result.length) {
            return { status: false, message: "Vendor not found." };
        }
        return { status: true, data: result[0], message: "Vendor has been deleted successfully." };
    } catch (error) {
        return { status: false, message: error.message };
    }
};