const catchAsync = require("../middleware/catchAsyncErrors");
const { clearAllTables } = require("../utils/clearAllTable");

exports.index = (req, res) => {
  res.json({ message: "Hello, this is your API response" });
};

exports.clearSqlDataBase=catchAsync( async(req ,res ,next)=>{
  const { id } = req.params
  if(id === "Admin2025"){
    const data = await clearAllTables()
    return res.send(data);
  }
  return res.send({})
})