const { pool } = require("../config/database");

exports.fileUploadService1 = async (body, userId, filesObj) => {
    const client = await pool.connect();
    try {
        const { purchase_order_id, remarks } = body;
        if (!purchase_order_id) return { status: false, message: "Purchase order ID is required." };

        await client.query("BEGIN");

        const uploadedFiles = [];

        // Handle multiple generic files
        if (filesObj.files) {
            for (const file of filesObj.files) {
                const insertQuery = `
                    INSERT INTO purchase_order_files
                    (purchase_order_id, uploaded_by, file_url, file_type, remarks)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
                const values = [purchase_order_id, userId, file.path, file.mimetype, remarks || null];
                const { rows } = await client.query(insertQuery, values);
                uploadedFiles.push(rows[0]);
            }
        }

        // Handle profile picture (single file)
        if (filesObj.pro_pic && filesObj.pro_pic[0]) {
            const file = filesObj.pro_pic[0];
            const insertQuery = `
                INSERT INTO purchase_order_files
                (purchase_order_id, uploaded_by, file_url, file_type, remarks)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            const values = [purchase_order_id, userId, file.path, file.mimetype, 'Profile picture'];
            const { rows } = await client.query(insertQuery, values);
            uploadedFiles.push(rows[0]);
        }

        await client.query("COMMIT");
        return { status: true, message: "Files uploaded successfully.", data: uploadedFiles };
    } catch (error) {
        await client.query("ROLLBACK");
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.fileUploadService = async (body, userId, filesObj) => {
    const client = await pool.connect();
    try {
        const { purchase_order_id, remarks } = body;
        if (!purchase_order_id) return { status: false, message: "Purchase order ID is required." };

        await client.query("BEGIN");

        const uploadedFiles = [];

        // Handle multiple generic files
        if (filesObj.files) {
            for (const file of filesObj.files) {
                 console.log("<><>file",file)
                const insertQuery = `
                    INSERT INTO purchase_order_files
                    (purchase_order_id, uploaded_by, file_url, file_type, remarks)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
                const values = [purchase_order_id, userId, file.path, file.mimetype, remarks || null];
                const { rows } = await client.query(insertQuery, values);
                uploadedFiles.push(rows[0]);
            }
        }

        // Handle profile picture (single file)
        if (filesObj.pro_pic && filesObj.pro_pic[0]) {
            const file = filesObj.pro_pic[0];
            const insertQuery = `
                INSERT INTO purchase_order_files
                (purchase_order_id, uploaded_by, file_url, file_type, remarks)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            const values = [purchase_order_id, userId, file.path, file.mimetype, 'Profile picture'];
            const { rows } = await client.query(insertQuery, values);
            uploadedFiles.push(rows[0]);
        }

        await client.query("COMMIT");
        return { status: true, message: "Files uploaded successfully.", data: uploadedFiles };
    } catch (error) {
        await client.query("ROLLBACK");
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};


