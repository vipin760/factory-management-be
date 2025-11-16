const { pool } = require("../config/database");

exports.createCustomerOrders = async (body, userId) => {
    const client = await pool.connect();
    try {
        const {
            transit_register_id,
            so_no,
            order_date,
            customer_name,
            customer_address,
            notes,
            rate,
            due_date,
            ordered_qty,
            transfered_qty,
            status
        } = body;

        await client.query("BEGIN");

        // -------------------------
        // VALIDATIONS
        // -------------------------
        if (!transit_register_id)
            return { status: false, message: "transit_register_id is required" };

        if (!so_no)
            return { status: false, message: "so_no (Sales Order Number) is required" };

        if (!customer_name)
            return { status: false, message: "customer_name is required" };

        if (!ordered_qty)
            return { status: false, message: "ordered_qty is required" };

        // If status PARTIAL or COMPLETED → transfered_qty required
        if ((status === "PARTIAL" || status === "COMPLETED") && !transfered_qty)
            return { status: false, message: "transfered_qty required when status is PARTIAL/COMPLETED" };

        // -------------------------
        // CHECK DUPLICATE SO NUMBER
        // -------------------------
        const soCheck = await client.query(
            `SELECT id FROM customer_orders WHERE so_no = $1`,
            [so_no]
        );

        if (soCheck.rows.length > 0)
            return { status: false, message: "Sales Order already exists" };

        // -------------------------
        // CHECK TRANSIT REGISTER VALIDITY
        // -------------------------
        const transit_registerData = await client.query(
            `SELECT * FROM transit_register WHERE id = $1`,
            [transit_register_id]
        );

        if (!transit_registerData.rows.length) {
            await client.query("ROLLBACK");
            return {
                status: false,
                message: "Transit register not found. Contact admin."
            };
        }

        const availableQty = transit_registerData.rows[0].quantity;

        // -------------------------
        // CHECK HOW MUCH IS ALREADY USED
        // -------------------------
        // Fetch total dispatched & total returned in ONE query
        const qtyResult = await client.query(
            `
    SELECT 
        -- Total dispatched where NOT returned
        (SELECT COALESCE(SUM(d1.transfered_qty), 0)
         FROM dispatch_orders d1
         JOIN customer_orders co1 ON d1.customer_orders_id = co1.id
         WHERE co1.transit_register_id = $1
         AND d1.return_status = FALSE
        ) AS total_dispatched,

        -- Total returned
        (SELECT COALESCE(SUM(d2.transfered_qty), 0)
         FROM dispatch_orders d2
         JOIN customer_orders co2 ON d2.customer_orders_id = co2.id
         WHERE co2.transit_register_id = $1
         AND d2.return_status = TRUE
        ) AS total_returned
    `,
            [transit_register_id]
        );

        const totalDispatched = parseFloat(qtyResult.rows[0].total_dispatched);
        const totalReturned = parseFloat(qtyResult.rows[0].total_returned);

        // FINAL USED QTY
        const finalUsedQty = totalDispatched - totalReturned;

        // FINAL REMAINING QTY
        const remainingQty = availableQty - finalUsedQty;

        // -------------------------
        // VALIDATE NEW ORDER
        // -------------------------
        if (parseFloat(transfered_qty) > remainingQty) {
            await client.query("ROLLBACK");
            return {
                status: false,
                message: `Only ${remainingQty} qty remaining for this transit register , but you tried ${transfered_qty}`
            };
        }

        // -------------------------
        // Validate transfer qty
        // -------------------------
        if (parseFloat(ordered_qty) > parseFloat(availableQty)) {
            return {
                status: false,
                message: "Ordered quantity cannot be greater than produced quantity"
            };
        }
        if (transfered_qty) {
            if (transfered_qty > ordered_qty) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message: "Transferred quantity cannot be greater than ordered quantity"
                };
            }

            if (transfered_qty > availableQty) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message: `Transferred quantity (${transfered_qty}) exceeds available quantity (${availableQty}) in transit register`
                };
            }
        }

        // -------------------------
        // INSERT CUSTOMER ORDER
        // -------------------------
        const insertQuery = `
            INSERT INTO customer_orders 
            (transit_register_id, so_no, order_date, customer_name, customer_address,
             ordered_qty, rate, due_date, notes, status, created_by, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
            RETURNING *;
        `;

        const values = [
            transit_register_id,
            so_no,
            order_date || new Date(),
            customer_name,
            customer_address || null,
            ordered_qty,
            rate || null,
            due_date || null,
            notes || null,
            status || "PENDING",
            userId
        ];

        const result = await client.query(insertQuery, values);
        const orderId = result.rows[0].id;

        // -------------------------
        // OPTIONAL DISPATCH INSERT
        // -------------------------
        if (status === "PARTIAL" || status === "COMPLETED") {
            const dispatchQuery = `
                INSERT INTO dispatch_orders
                (customer_orders_id, transfered_qty, created_by)
                VALUES ($1, $2, $3)
                RETURNING *;
            `;

            await client.query(dispatchQuery, [
                orderId,
                transfered_qty,
                userId
            ]);
        }

        await client.query("COMMIT");

        return {
            status: true,
            message: "Customer Order Created Successfully",
            data: result.rows[0]
        };

    } catch (error) {
        await client.query("ROLLBACK");
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};

exports.getCustomerOrders1 = async (query) => {
    const client = await pool.connect();

    try {
        let {
            page = 1,
            limit = 10,
            search = "",
            status,
            start_date,
            end_date,
            so_no,
            sort_by = "created_at",
            sort_type = "DESC"
        } = query;

        page = parseInt(page);
        limit = parseInt(limit);

        // Base Query
        let where = `WHERE 1=1`;
        const params = [];
        let paramIndex = 1;

        // -------------------------
        // SEARCH (customer_name, so_no)
        // -------------------------
        if (search) {
            where += ` AND (LOWER(customer_name) LIKE $${paramIndex} OR LOWER(so_no) LIKE $${paramIndex})`;
            params.push(`%${search.toLowerCase()}%`);
            paramIndex++;
        }

        // -------------------------
        // FILTER STATUS
        // -------------------------
        if (status) {
            where += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        // -------------------------
        // FILTER BY DATE RANGE
        // -------------------------
        if (start_date) {
            where += ` AND order_date >= $${paramIndex}`;
            params.push(start_date);
            paramIndex++;
        }

        if (end_date) {
            where += ` AND order_date <= $${paramIndex}`;
            params.push(end_date);
            paramIndex++;
        }

        // -------------------------
        // FILTER BY SO NUMBER EXACT MATCH
        // -------------------------
        if (so_no) {
            where += ` AND so_no = $${paramIndex}`;
            params.push(so_no);
            paramIndex++;
        }

        // -------------------------
        // SORTING
        // -------------------------
        const allowedSort = [
            "customer_name",
            "so_no",
            "order_date",
            "status",
            "created_at",
            "ordered_qty"
        ];

        if (!allowedSort.includes(sort_by)) sort_by = "created_at";
        if (!["ASC", "DESC"].includes(sort_type)) sort_type = "DESC";

        const offset = (page - 1) * limit;

        // -------------------------
        // FINAL QUERY WITH DISPATCH SUMMARY
        // -------------------------
        const queryData = `
            SELECT 
                co.*,
                COALESCE(SUM(d.transfered_qty), 0) AS total_transferred_qty
            FROM customer_orders co
            LEFT JOIN dispatch_orders d 
                ON co.id = d.customer_orders_id
            ${where}
            GROUP BY co.id
            ORDER BY ${sort_by} ${sort_type}
            LIMIT ${limit} OFFSET ${offset};
        `;

        //  const queryData = `
        //     SELECT 
        //         co.*
        //     FROM customer_orders co
        //     LEFT JOIN dispatch_orders d
        //     ON co.id = d.customer_orders_id
        // `;

        const rows = await client.query(queryData, params);

        // COUNT TOTAL
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM customer_orders co
            ${where};
        `;
        const totalCount = await client.query(countQuery, params);

        return {
            status: true,
            message: "Customer Orders Fetched Successfully",
            total: parseInt(totalCount.rows[0].total),
            page,
            limit,
            data: rows.rows
        };

    } catch (error) {
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};

exports.getCustomerOrders = async (query) => {
    const client = await pool.connect();

    try {
        let {
            page = 1,
            limit = 10,
            search = "",
            status,
            start_date,
            end_date,
            so_no,
            sort_by = "created_at",
            sort_type = "DESC",
        } = query;

        page = parseInt(page);
        limit = limit === "all" ? "all" : parseInt(limit);

        // -----------------------------
        // Build dynamic WHERE clauses
        // -----------------------------
        const whereClauses = ["1=1"];
        const values = [];
        let idx = 1;

        if (search) {
            whereClauses.push(
                `(LOWER(customer_name) LIKE LOWER($${idx}) OR LOWER(so_no) LIKE LOWER($${idx}))`
            );
            values.push(`%${search}%`);
            idx++;
        }

        if (status) {
            whereClauses.push(`status = $${idx}`);
            values.push(status);
            idx++;
        }

        if (start_date) {
            whereClauses.push(`order_date >= $${idx}`);
            values.push(start_date);
            idx++;
        }

        if (end_date) {
            whereClauses.push(`order_date <= $${idx}`);
            values.push(end_date);
            idx++;
        }

        if (so_no) {
            whereClauses.push(`so_no = $${idx}`);
            values.push(so_no);
            idx++;
        }

        const whereQuery = `WHERE ${whereClauses.join(" AND ")}`;

        // -----------------------------
        // Sorting
        // -----------------------------
        const allowedSort = [
            "customer_name",
            "so_no",
            "order_date",
            "status",
            "created_at",
            "ordered_qty",
        ];

        const orderColumn = allowedSort.includes(sort_by) ? sort_by : "created_at";
        const orderDirection = sort_type.toUpperCase() === "ASC" ? "ASC" : "DESC";

        // -----------------------------
        // Pagination
        // -----------------------------
        const offset = (page - 1) * (limit === "all" ? 0 : limit);
        const paginationQuery = limit === "all" ? "" : `LIMIT ${limit} OFFSET ${offset}`;

        // -----------------------------
        // Main query with dispatch summary
        // -----------------------------
        // const dataQuery = `
        //     SELECT 
        //         co.*,
        //         COALESCE(SUM(d.transfered_qty), 0) AS total_transferred_qty
        //     FROM customer_orders co
        //     LEFT JOIN dispatch_orders d 
        //         ON co.id = d.customer_orders_id
        //     ${whereQuery}
        //     GROUP BY co.id
        //     ORDER BY ${orderColumn} ${orderDirection}
        //     ${paginationQuery};
        // `;

        const dataQuery = `SELECT 
    co.*,
    ma.article_name,
    ma.remarks AS article_remarks,
    COALESCE(SUM(d.transfered_qty), 0) AS total_transferred_qty
FROM customer_orders co
LEFT JOIN dispatch_orders d 
    ON co.id = d.customer_orders_id
LEFT JOIN transit_register tr
    ON tr.id = co.transit_register_id
LEFT JOIN manufacture_articles ma
    ON ma.id = tr.manufacture_articles_id
${whereQuery}
GROUP BY 
    co.id, 
    ma.article_name, 
    ma.remarks
ORDER BY ${orderColumn} ${orderDirection}
${paginationQuery};
`

        // -----------------------------
        // Count query
        // -----------------------------
        const countQuery = `
            SELECT COUNT(*) AS total_records
            FROM customer_orders co
            ${whereQuery};
        `;

        const [dataResult, countResult] = await Promise.all([
            client.query(dataQuery, values),
            client.query(countQuery, values),
        ]);

        const totalRecords = parseInt(countResult.rows[0]?.total_records || 0);

        const pagination =
            limit === "all"
                ? null
                : {
                    total_records: totalRecords,
                    current_page: page,
                    total_pages: Math.ceil(totalRecords / limit),
                    limit: limit,
                };

        return {
            status: true,
            message: "Customer Orders fetched successfully",
            data: { data: dataResult.rows, pagination },
        };
    } catch (error) {
        console.error("❌ Error in getCustomerOrders:", error);
        return {
            status: false,
            message: `Something went wrong (${error.message})`,
        };
    } finally {
        client.release();
    }
};

exports.deleteCustomerOrder = async (orderId) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Check order exists
        const order = await client.query(
            `SELECT id FROM customer_orders WHERE id = $1`,
            [orderId]
        );

        if (!order.rows.length) {
            await client.query("ROLLBACK");
            return { status: false, message: "Customer order not found" };
        }

        // Delete (dispatch_orders auto deleted)
        await client.query(
            `DELETE FROM customer_orders WHERE id = $1`,
            [orderId]
        );

        await client.query("COMMIT");

        return {
            status: true,
            message: "Customer Order deleted successfully"
        };

    } catch (error) {
        await client.query("ROLLBACK");
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};

exports.getCustomerOrderById = async (orderId) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Check order exists
        const order = await client.query(
            `SELECT * FROM customer_orders WHERE id = $1`,
            [orderId]
        );

        if (!order.rows.length) {
            await client.query("ROLLBACK");
            return { status: false, message: "Customer order not found" };
        }

        await client.query("COMMIT");

        return {
            status: true,
            data: order.rows[0],
            message: "Customer Order fetch successfully"
        };

    } catch (error) {
        await client.query("ROLLBACK");
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};

exports.updateCustomerOrder = async (body, orderId, userId) => {
    const client = await pool.connect();
    //---------------------------------------------------------
    // DESTRUCTURE PAYLOAD
    //---------------------------------------------------------
    const {
        so_no,
        customer_name,
        customer_address,
        ordered_qty,
        rate,
        order_date,
        due_date,
        notes,
        transfered_qty,
        return_qty
    } = body;
    try {
        await client.query("BEGIN");

        //---------------------------------------------------------
        // 1. FETCH EXISTING ORDER
        //---------------------------------------------------------
        const orderRes = await client.query(
            `SELECT * FROM customer_orders WHERE id = $1`,
            [orderId]
        );

        if (orderRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return { status: false, message: "Order not found" };
        }

        const order = orderRes.rows[0];

        //---------------------------------------------------------
        // 2. FETCH PER-ORDER DISPATCH QTY
        //---------------------------------------------------------
        const qtyResult = await client.query(
            `
            SELECT 
                COALESCE(SUM(d.transfered_qty), 0) AS total_dispatched,
                COALESCE(SUM(CASE WHEN d.return_status = TRUE THEN d.transfered_qty ELSE 0 END), 0) AS total_returned
            FROM dispatch_orders d
            WHERE d.customer_orders_id = $1
            `,
            [orderId]
        );

        const totalDispatched = parseFloat(qtyResult.rows[0].total_dispatched);
        const totalReturned = parseFloat(qtyResult.rows[0].total_returned);

        const finalUsedQty = totalDispatched - totalReturned;
        const remainingQty = order.ordered_qty - finalUsedQty;

        //---------------------------------------------------------
        // CHECK TRANSIT REGISTER VALIDITY
        // ------------------------- 
        const { transit_register_id } = order
        const transit_registerData = await client.query(
            `SELECT * FROM transit_register WHERE id = $1`,
            [transit_register_id]
        );

        if (!transit_registerData.rows.length) {
            await client.query("ROLLBACK");
            return {
                status: false,
                message: "Transit register not found. Contact admin."
            };
        }

        const availableQty = transit_registerData.rows[0].quantity;



        if (parseFloat(ordered_qty) > parseFloat(availableQty)) {
            return {
                status: false,
                message: "Ordered quantity cannot be greater than produced quantity"
            };
        }

        //---------------------------------------------------------
        // 4. SO_NO DUPLICATE CHECK
        //---------------------------------------------------------
        if (so_no) {
            const soRes = await client.query(
                `SELECT id FROM customer_orders WHERE so_no = $1 AND id != $2`,
                [so_no, orderId]
            );

            if (soRes.rows.length > 0) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message: `SO Number ${so_no} already exists`
                };
            }
        }

        //---------------------------------------------------------
        // 5. DYNAMIC UPDATE OF CUSTOMER ORDER
        //---------------------------------------------------------
        const fields = [];
        const values = [];
        let idx = 1;

        // Only add fields if they exist in the body
        const updatableFields = [
            "so_no",
            "customer_name",
            "customer_address",
            "ordered_qty",
            "rate",
            "order_date",
            "due_date",
            "notes",
            "status"
        ];

        updatableFields.forEach((field) => {
            if (body[field] !== undefined && body[field] !== null) {
                fields.push(`${field} = $${idx}`);
                values.push(body[field]);
                idx++;
            }
        });

        if (fields.length > 0) {
            const updateQuery = `
        UPDATE customer_orders
        SET ${fields.join(", ")}
        WHERE id = $${idx}
    `;
            values.push(orderId);
            await client.query(updateQuery, values);
        }


        //---------------------------------------------------------
        // 6. HANDLE RETURN QTY (manual returns)
        //---------------------------------------------------------
        // const returnQtyNum = Number(return_qty) || 0;

        // if (returnQtyNum > 0) {
        //     await client.query(
        //         `
        //         INSERT INTO dispatch_orders
        //         (customer_orders_id, transfered_qty, return_status, created_by)
        //         VALUES ($1, $2, TRUE, $3)
        //         `,
        //         [orderId, returnQtyNum, userId]
        //     );
        // }

        //---------------------------------------------------------
        // 7. HANDLE TRANSFER QTY (with automatic return for over-transfer)
        //---------------------------------------------------------
        // let transferQtyNum = Number(transfered_qty) || 0;

        // if (transferQtyNum > 0) {
        //     const totalAttempted = finalUsedQty + transferQtyNum;
        //     let excessQty = 0;

        //     if (totalAttempted > order.ordered_qty) {
        //         // Calculate excess quantity to return automatically
        //         excessQty = totalAttempted - order.ordered_qty;
        //         transferQtyNum = transferQtyNum - excessQty; // only allow correct transfer
        //     }

        //     if (transferQtyNum > 0) {
        //         await client.query(
        //             `
        //             INSERT INTO dispatch_orders
        //             (customer_orders_id, transfered_qty, return_status, created_by)
        //             VALUES ($1, $2, FALSE, $3)
        //             `,
        //             [orderId, transferQtyNum, userId]
        //         );
        //     }

        //     if (excessQty > 0) {
        //         await client.query(
        //             `
        //             INSERT INTO dispatch_orders
        //             (customer_orders_id, transfered_qty, return_status, created_by)
        //             VALUES ($1, $2, TRUE, $3)
        //             `,
        //             [orderId, excessQty, userId]
        //         );
        //     }
        // }

        //---------------------------------------------------------
        // 8. AUTO STATUS UPDATE
        //---------------------------------------------------------
        // const newFinalUsed = finalUsedQty + transferQtyNum - returnQtyNum;

        // let newStatus = "PENDING";

        // if (newFinalUsed === 0) newStatus = "PENDING";
        // else if (newFinalUsed < order.ordered_qty) newStatus = "PARTIAL";
        // else if (newFinalUsed >= order.ordered_qty) newStatus = "COMPLETED";

        // await client.query(
        //     `UPDATE customer_orders SET status = $1 WHERE id = $2`,
        //     [newStatus, orderId]
        // );

        //---------------------------------------------------------
        // 9. COMMIT
        //---------------------------------------------------------
        await client.query("COMMIT");

        return {
            status: true,
            message: "Customer order updated successfully",
        };

    } catch (error) {
        await client.query("ROLLBACK");
        return {
            status: false,
            message: `Something went wrong (${error.message})`
        };
    } finally {
        client.release();
    }
};

exports.transferOrReturnCustomerOrder = async (body, userId) => {
    const client = await pool.connect();
    try {
        const { customer_order_id, transfered_qty = 0, return_qty = 0 } = body;

        if (!customer_order_id)
            return { status: false, message: "customer_order_id is required" };

        await client.query("BEGIN");

        // -------------------------
        // Fetch customer order & transit register
        // -------------------------
        const orderRes = await client.query(
            `SELECT co.*, tr.quantity AS transit_quantity
             FROM customer_orders co
             JOIN transit_register tr ON co.transit_register_id = tr.id
             WHERE co.id = $1`,
            [customer_order_id]
        );

        if (orderRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return { status: false, message: "Customer order not found" };
        }

        const order = orderRes.rows[0];

        // -------------------------
        // Calculate dispatched & returned
        // -------------------------
        const qtyResult = await client.query(
            `
            SELECT 
                COALESCE(SUM(CASE WHEN return_status = FALSE THEN transfered_qty END),0) AS total_dispatched,
                COALESCE(SUM(CASE WHEN return_status = TRUE THEN transfered_qty END),0) AS total_returned
            FROM dispatch_orders
            WHERE customer_orders_id = $1
            `,
            [customer_order_id]
        );

        const totalDispatched = parseInt(qtyResult.rows[0].total_dispatched);
        const totalReturned = parseInt(qtyResult.rows[0].total_returned);

        const finalUsedQty = totalDispatched - totalReturned;
        const remainingQty = order.ordered_qty - finalUsedQty;

        // -------------------------
        // Handle transfer
        // -------------------------
        let transferQtyNum = parseInt(transfered_qty) || 0;
        if (transferQtyNum > 0) {
            if (transferQtyNum > remainingQty) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message: `Cannot transfer ${transferQtyNum}. Only ${remainingQty} remaining`
                };
            }

            await client.query(
                `INSERT INTO dispatch_orders
                 (customer_orders_id, transfered_qty, return_status, created_by)
                 VALUES ($1, $2, FALSE, $3)`,
                [customer_order_id, transferQtyNum, userId]
            );
        }

        // -------------------------
        // Handle return
        // -------------------------
        let returnQtyNum = parseInt(return_qty) || 0;
        if (returnQtyNum > 0) {
            if (returnQtyNum > finalUsedQty) {
                await client.query("ROLLBACK");
                return {
                    status: false,
                    message: `Cannot return ${returnQtyNum}. Only ${finalUsedQty} has been transferred`
                };
            }

            await client.query(
                `INSERT INTO dispatch_orders
                 (customer_orders_id, transfered_qty, return_status, created_by)
                 VALUES ($1, $2, TRUE, $3)`,
                [customer_order_id, returnQtyNum, userId]
            );
        }

        // -------------------------
        // Update order status
        // -------------------------
        const newFinalUsed = finalUsedQty + transferQtyNum - returnQtyNum;
        let newStatus = "PENDING";
        if (newFinalUsed === 0) newStatus = "PENDING";
        else if (newFinalUsed < order.ordered_qty) newStatus = "PARTIAL";
        else if (newFinalUsed >= order.ordered_qty) newStatus = "COMPLETED";

        await client.query(
            `UPDATE customer_orders SET status = $1 WHERE id = $2`,
            [newStatus, customer_order_id]
        );

        await client.query("COMMIT");

        return {
            status: true,
            message: "Transfer/Return processed successfully",
            data: {
                customer_order_id,
                transferred_qty: transferQtyNum,
                returned_qty: returnQtyNum,
                new_status: newStatus
            }
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error(error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

