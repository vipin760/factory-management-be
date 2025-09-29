const express = require('express')
const cors = require('cors')
const errorMiddleare = require('./middleware/error')
const path = require('path')
const morgan = require('morgan');
const logger = require("./utils/logger");
const app = express()

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('combined', {
    stream: { write: (message) => logger.http(message.trim()) }
}))
app.use(express.json())
app.use(cors());

//routes
const indexRoutes = require('./routes/index')
const authRoutes = require("./routes/auth.route")
const indentRoutes = require("./routes/indent.route")
const rawMaterialsRoutes = require("./routes/rawMaterials.route");
const purchaseRoutes = require("./routes/purchase.route");
const vendorRoutes = require("./routes/vendors.route");
const grnRoutes = require('./routes/grns.route')
const userRoutes = require('./routes/user.route')

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/", indexRoutes);
app.use("/api/auth", authRoutes)
app.use("/api/indent", indentRoutes)
app.use("/api/raw-material", rawMaterialsRoutes)
app.use("/api/purchase", purchaseRoutes)
app.use("/api/vendor", vendorRoutes)
app.use("/api/grns",grnRoutes);
app.use("/api/user",userRoutes);

//error middleware
app.use(errorMiddleare);

module.exports = app