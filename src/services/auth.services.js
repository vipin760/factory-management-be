const { sqlQueryFun } = require("../database/sql/sqlFunction");
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')

exports.registerUserService = async (body) => {
    try {
        const { name, email, password, role } = body

    if(!name) return { status: false, data: [], message: "Name field required" }
    if(!email) return { status: false, data: [], message: "email field required" }
    if(!password) return { status: false, data: [], message: "password field required" }
    if(!role) return { status: false, data: [], message: "Role field required" }

    const emailExistQry = `SELECT * FROM users WHERE email = $1`
    const emailExistVal = [email]
    const EmailExist = await sqlQueryFun(emailExistQry, emailExistVal)
    if (EmailExist.length != 0) return { status: false, data: EmailExist, message: "Email already exist" }

    const createUserQry = ` INSERT INTO users (name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING *`
    const password_hash = await bcrypt.hash(password,10)
    const createUserval = [name, email,password_hash , role];
    const result = await sqlQueryFun(createUserQry, createUserval);
    return {status:true,data:result[0], message:"User registration completed successfully"}
    } catch (error) {
        return { status:false,message:`something went wrog please try again after sometimes (${error.message})`}
    }
}

exports.loginUserService = async(body)=>{
    try {
        const {email, password} = body

    if(!email) return { status: false, data: [], message: "email field required" }
    if(!password) return { status: false, data: [], message: "password field required" }

    const emailExistQry = `SELECT * FROM users WHERE email = $1`
    const emailExistVal = [email]
    const EmailExist = await sqlQueryFun(emailExistQry, emailExistVal)
    if(!EmailExist.length) return { status: false, data: EmailExist, message: "No account found with this email address" }
    const {id,role,name} = EmailExist[0]
    const passwordMatch = await bcrypt.compare(password,EmailExist[0].password_hash)
    if(!passwordMatch) return { status: false, message: "The password you entered is incorrect" }
    const token = jwt.sign({id:id,role:role,email:email},process.env.JWT_SECRET,{expiresIn:"30d"})
   const resut = {role,email,name,token}
    return {status:true,data:resut,message:"You have logged in successfully"}
    } catch (error) {
        return { status:false,message:`something went wrog please try again after sometimes (${error.message})`}
    }
}