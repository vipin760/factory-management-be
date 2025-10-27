const { sqlQueryFun } = require("../database/sql/sqlFunction");
const catchAsync = require("../middleware/catchAsyncErrors");
const { clearAllTables, dropAllTables } = require("../utils/clearAllTable");
const bcrypt = require('bcrypt')

exports.index = (req, res) => {
  res.json({ message: "Hello, this is your API response" });
};

exports.createDefaultUser = catchAsync( async(req ,res,next)=>{
  const email = "admin@gmail.com"
  const name = "admin"
  const role = "admin"
  const password = "admin@123"
      const emailExistQry = `SELECT * FROM users WHERE email = $1`
      const emailExistVal = [email]
      const EmailExist = await sqlQueryFun(emailExistQry, emailExistVal)
      if (EmailExist.length != 0) {
        return { status: false, data: EmailExist, message: "Email already exist" }
      }
  
      const createUserQry = ` INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING *`
      const password_hash = await bcrypt.hash(password,10)
      const createUserval = [name, email,password_hash , role];
      const result = await sqlQueryFun(createUserQry, createUserval);
      return res.status(200).send({status:true,message:"default user created successfully"})
})

// exports.clearSqlDataBase=catchAsync( async(req ,res ,next)=>{
//   const { id } = req.params
//   if(id === "Admin2025"){
//     const data = await clearAllTables()
//     return res.send(data);
//   }
//   return res.send({status:false,message:"something went wrong"})
// })

exports.clearSqlDataBase=async(req,res)=>{
  try {
    const { id } = req.params
    console.log("<><>id" ,id === "Admin2025")
  if(id === "Admin2025"){
    const {status,message} = await clearAllTables()
    return res.status(200).send({status,message});
  }
  if(id === "Table2025"){
    const {status,message} = await dropAllTables()
    return res.status(200).send({status,message});
  }
   return res.status(200).send({status:true,message:"database not delete check params"});
  } catch (error) {
    return res.status(500).send({status:false,message:`1internal server down (${error.message})`})
  }
}