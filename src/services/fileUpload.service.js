const { pool } = require("../config/database");
const fs = require('fs');
const path = require('path');
const { sqlQueryFun } = require("../database/sql/sqlFunction");

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
        console.log("<><>error",error)
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

exports.deleteFileService = async (fileId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ✅ 1. Fetch file details from DB
        const fileRes = await client.query(
            `SELECT id, file_url, uploaded_by 
             FROM purchase_order_files 
             WHERE id = $1`,
            [fileId]
        );

        if (fileRes.rowCount === 0) {
            return { status: false, message: 'File not found.' };
        }

        const fileData = fileRes.rows[0];

        // (Optional) ✅ Check if the user deleting is the one who uploaded
        if (fileData.uploaded_by !== userId) {
            return { status: false, message: 'Unauthorized action.' };
        }

        // ✅ 2. Delete file record from DB
        await client.query(
            `DELETE FROM purchase_order_files WHERE id = $1`,
            [fileId]
        );

        // ✅ 3. Delete file from local storage
        const filePath = path.resolve(fileData.file_url);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await client.query('COMMIT');
        return { status: true, message: 'File deleted successfully.' };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('File delete error:', error);
        return { status: false, message: `Something went wrong (${error.message})` };
    } finally {
        client.release();
    }
};

exports.getAllFilesService = async()=>{
    try {
        const result = await sqlQueryFun(`SELECT * FROM purchase_order_files`)
        return { status:true, data:result, message:"data fetched"}
    } catch (error) {
        return { status:false,message:`something went wrong (${error.message})`}
    }
}

