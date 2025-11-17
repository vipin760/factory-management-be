const jwt = require("jsonwebtoken");
const { sqlQueryFun } = require("../database/sql/sqlFunction");
// Storekeeper, Jailor, Superintendent

exports.authenticate = async(req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const {id, role, email } = decoded
    const userExist = await sqlQueryFun(`SELECT * FROM users where id = $1`,[id])
  if(!userExist.length){
    return res.status(401).json({ message: "user doesn't exist." });
  }
    req.user = {id,role,email}; 
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

exports.authorizeRoles = (...roles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(403).json({ message: "Access denied." });
      }
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: "You do not have permission to access this resource." });
      }
      next();
    };
  };