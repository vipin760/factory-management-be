exports.createAuditLog = async (client, { entityType, entityId, action, userId, details = {}, status = null, metadata = {} }) => {
    try {
        const query = `
        INSERT INTO audit_logs (entity_type, entity_id, action, user_id, details, status, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
    const values = [entityType, entityId, action, userId, details, status, metadata];
   const { rows }= await client.query(query, values)
   console.log("<><>rows",rows)
   return rows[0]
   
    } catch (error) {
        console.log("<><>error",error.message)
    }
};