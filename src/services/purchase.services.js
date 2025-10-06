const { pool } = require("../config/database");
const { sqlQueryFun } = require("../database/sql/sqlFunction");
const { validate: isUuid } = require('uuid');

exports.createNewPurchaseOrderService = async (body, userId, userRole) => {
  const client = await pool.connect();
  try {
    const { po_no, vendor_id, indent_id, expected_delivery, remarks, items, status } = body;
    if (status === "approved" && userRole != "admin") return { status: false, message: "Only the admin has permission to change this status" }
    // -------------------- VALIDATION --------------------
    if (!po_no) return { status: false, message: "PO number (po_no) is required." };
    if (!vendor_id) return { status: false, message: "Vendor ID is required." };
    if (!indent_id) return { status: false, message: "Indent ID is required." };
    if (!Array.isArray(items) || items.length === 0) {
      return { status: false, message: "At least one item is required in the purchase order." };
    }

    // Validate each item
    for (const item of items) {
      if (!item.raw_material_id || item.qty == null || item.rate == null) {
        return { status: false, message: "Each item must include raw_material_id, qty, and rate." };
      }
      if (!isUuid(item.raw_material_id)) {
        return { status: false, message: `Invalid raw_material_id: '${item.raw_material_id}'` };
      }
    }

    await client.query('BEGIN');

    // Check if PO number already exists
    const existingPO = await sqlQueryFun(
      `SELECT id FROM purchase_orders WHERE purchase_order_id = $1`,
      [po_no]
    );
    if (existingPO.length > 0) {
      await client.query('ROLLBACK');
      return { status: false, message: "PO number already exists. Use a unique PO number." };
    }

    // Check if indent exists
    const indentCheck = await sqlQueryFun(`SELECT 1 FROM indents WHERE id = $1`, [indent_id]);
    if (!indentCheck.length) {
      await client.query('ROLLBACK');
      return { status: false, message: `Indent with ID ${indent_id} not found.` };
    }

    const vendorCheck = await sqlQueryFun(`SELECT 1 FROM vendors WHERE id = $1`, [vendor_id]);
    if (!vendorCheck.length) {
      await client.query('ROLLBACK');
      return { status: false, message: `vendor with ID ${vendor_id} not found.` };
    }

    // Insert purchase order
    const insertPOQuery = `
      INSERT INTO purchase_orders 
        (purchase_order_id, indent_id, vendor_id, created_by, order_date, expected_delivery,status, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7,$8)
      RETURNING *;
    `;
    let [po] = await sqlQueryFun(insertPOQuery, [
      po_no,
      indent_id,
      vendor_id,
      userId,
      new Date(),
      expected_delivery || null,
      status || 'draft',
      remarks || null
    ]);
    po = po;


    // Insert items and calculate total amount
    let totalAmount = 0;
    for (const item of items) {
      const lineAmount = Number(item.qty) * Number(item.rate);
      totalAmount += lineAmount;

      const datas = await sqlQueryFun(
        `INSERT INTO purchase_order_items
          (purchase_order_id, raw_material_id, qty, rate, remarks)
         VALUES ($1, $2, $3, $4, $5)`,
        [po.id, item.raw_material_id, item.qty, item.rate, item.remarks || null]
      );

      await sqlQueryFun(
        `INSERT INTO ordered_item_history 
    (purchase_orders_id, changed_by, old_status, new_status, old_qty, new_qty, old_rate, new_rate, remarks)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          po.id,
          userId,
          null,
          status || 'draft',
          null,
          Number(item.qty),
          null,
          Number(item.rate),
          'Purchase order created'
        ]
      );

    }


    await sqlQueryFun(
      `UPDATE purchase_orders SET total_amount = $1, updated_at = now() WHERE id = $2`,
      [totalAmount, po.id]
    );

    await client.query('COMMIT');

    return {
      status: true,
      message: "Purchase order created successfully.",
      data: { ...po, total_amount: totalAmount, items }
    };

  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`
    };
  }
};

exports.getAllPurchaseOrderService = async (queryParams) => {
  try {
    let { po_no, vendor_id, vendor_name, status, startDate, endDate, page, limit, sortBy, sortOrder } = queryParams;
    page = parseInt(page) || 1;
    limit = limit ? parseInt(limit) : null;

    sortBy = sortBy || 'created_at';
    sortOrder = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Base query to fetch purchase orders with items
    let baseQuery = `
      SELECT po.*, v.name AS vendor_name,
             i.indent_no AS indent_no,
             json_agg(
               json_build_object(
                 'id', poi.id,
                 'raw_material_id', poi.raw_material_id,
                 'raw_material_name', rm.name,
                 'raw_material_code', rm.code,
                 'qty', poi.qty,
                 'rate', poi.rate,
                 'total_amount', poi.total_amount,
                 'remarks', poi.remarks
               )
             ) FILTER (WHERE poi.id IS NOT NULL) AS items
      FROM purchase_orders po
      JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN indents i ON po.indent_id = i.id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      LEFT JOIN raw_materials rm ON poi.raw_material_id = rm.id
      WHERE 1=1
    `;

    const values = [];
    let idx = 1;

    if (po_no) {
      baseQuery += ` AND po.purchase_order_id ILIKE $${idx}`;
      values.push(`%${po_no}%`);
      idx++;
    }
    if (vendor_id) {
      baseQuery += ` AND po.vendor_id = $${idx}`;
      values.push(vendor_id);
      idx++;
    }
    if (vendor_name) {
      baseQuery += ` AND v.name ILIKE $${idx}`;
      values.push(`%${vendor_name}%`);
      idx++;
    }
    if (status) {
      baseQuery += ` AND po.status = $${idx}`;
      values.push(status);
      idx++;
    }
    if (startDate) {
      baseQuery += ` AND po.created_at >= $${idx}`;
      values.push(startDate);
      idx++;
    }
    if (endDate) {
      baseQuery += ` AND po.created_at <= $${idx}`;
      values.push(endDate);
      idx++;
    }

    baseQuery += ` GROUP BY po.id, v.name, i.indent_no`;
    baseQuery += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (limit) {
      const offset = (page - 1) * limit;
      baseQuery += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    const purchases = await sqlQueryFun(baseQuery, values);

    // Total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT po.id) AS total
      FROM purchase_orders po
      JOIN vendors v ON po.vendor_id = v.id
      WHERE 1=1
    `;
    const countValues = [];
    let countIdx = 1;

    if (po_no) {
      countQuery += ` AND po.purchase_order_id ILIKE $${countIdx}`;
      countValues.push(`%${po_no}%`);
      countIdx++;
    }
    if (vendor_id) {
      countQuery += ` AND po.vendor_id = $${countIdx}`;
      countValues.push(vendor_id);
      countIdx++;
    }
    if (vendor_name) {
      countQuery += ` AND v.name ILIKE $${countIdx}`;
      countValues.push(`%${vendor_name}%`);
      countIdx++;
    }
    if (status) {
      countQuery += ` AND po.status = $${countIdx}`;
      countValues.push(status);
      countIdx++;
    }
    if (startDate) {
      countQuery += ` AND po.created_at >= $${countIdx}`;
      countValues.push(startDate);
      countIdx++;
    }
    if (endDate) {
      countQuery += ` AND po.created_at <= $${countIdx}`;
      countValues.push(endDate);
      countIdx++;
    }

    const countResult = await sqlQueryFun(countQuery, countValues);
    const total = parseInt(countResult[0]?.total || 0);

    const result = { purchases, total, page, limit: limit || total };
    if (purchases.length !== 0)
      return { status: true, message: "Purchase orders fetched successfully", data: result };

    return { status: true, message: "No purchase orders found", data: result };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong. (${error.message})`
    };
  }
};

exports.deletePurchaseOrderService = async (id) => {
  try {
    if (!id) return { status: false, message: "id is required" }

    const existing = await sqlQueryFun(`SELECT id FROM purchase_orders WHERE id = $1`, [id]);
    if (!existing.length) return { status: false, message: "Purchase order not found." };

    const result = await sqlQueryFun(`DELETE FROM purchase_orders WHERE id = $1 RETURNING *`, [id]);

    return { status: true, data: result, message: "Purchase order and its related items deleted successfully." };
  } catch (error) {
    return { status: false, message: `Something went wrong on our end. Please try again later. (${error.message})` }
  }
}

exports.updatePurchaseOrderService = async (id, body) => {
  try {
    const { po_no, vendor_id, expected_delivery, indent_id, status, items } = body;
    if (!id) return { status: false, message: "Purchase Order ID is required." };

    const [existing] = await sqlQueryFun(
      `SELECT id FROM purchase_orders WHERE id = $1`,
      [id]
    );
    if (!existing) {
      return { status: false, message: "Purchase order not found." };
    }

    // 2️⃣ Update header fields only if provided
    const updateFields = [];
    const values = [];
    let idx = 1;

    if (po_no) {
      updateFields.push(`po_no = $${idx++}`);
      values.push(po_no);
    }
    if (vendor_id) {
      updateFields.push(`vendor_id = $${idx++}`);
      values.push(vendor_id);
    }
    if (expected_delivery !== undefined) {
      updateFields.push(`expected_delivery = $${idx++}`);
      values.push(expected_delivery);
    }
    if (status) {
      updateFields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (indent_id) {
      updateFields.push(`indent_id = $${idx++}`);
      values.push(indent_id);
    }

    if (updateFields.length) {
      values.push(id);
      await sqlQueryFun(
        `UPDATE purchase_orders SET ${updateFields.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

    // 3️⃣ Handle items: add new or update changed ones (no deletion)
    let totalValue = 0;
    if (Array.isArray(items) && items.length > 0) {
      // Get current items for change detection
      const currentItems = await sqlQueryFun(
        `SELECT id, raw_material_id, qty, uom, rate
         FROM purchase_order_items WHERE purchase_order_id = $1`,
        [id]
      );
      const currentMap = new Map(currentItems.map(it => [it.id, it]));

      for (const itm of items) {
        if (!itm.raw_material_id || itm.qty == null || itm.uom == null || itm.rate == null) {
          return {
            status: false,
            message: "Each item must include raw_material_id, qty, uom, and rate.",
          };
        }

        const lineAmount = Number(itm.qty) * Number(itm.rate);
        totalValue += lineAmount;

        if (itm.id && currentMap.has(itm.id)) {
          // Check if any field changed
          const old = currentMap.get(itm.id);
          const changed =
            old.raw_material_id !== itm.raw_material_id ||
            Number(old.qty) !== Number(itm.qty) ||
            old.uom !== itm.uom ||
            Number(old.rate) !== Number(itm.rate);

          if (changed) {
            await sqlQueryFun(
              `UPDATE purchase_order_items
                 SET raw_material_id = $1, qty = $2, uom = $3, rate = $4
               WHERE id = $5`,
              [itm.raw_material_id, itm.qty, itm.uom, itm.rate, itm.id]
            );
          }
        } else {
          // insert new
          await sqlQueryFun(
            `INSERT INTO purchase_order_items
             (purchase_order_id, raw_material_id, qty, uom, rate)
             VALUES ($1,$2,$3,$4,$5)`,
            [id, itm.raw_material_id, itm.qty, itm.uom, itm.rate]
          );
        }
      }

      // update total value only if items provided
      await sqlQueryFun(
        `UPDATE purchase_orders SET total_value = $1 WHERE id = $2`,
        [totalValue, id]
      );
    }

    return { status: true, message: "Purchase order updated successfully." };
  } catch (error) {
    return {
      status: false,
      message: `Something went wrong on our end. Please try again later. (${error.message})`,
    };
  }
};




