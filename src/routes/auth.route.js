const express = require('express')
const routes = express()
const authController = require('../controllers/auth.controller');

routes.post("/",authController.RegisterUser);
routes.post("/login",authController.loginUser)

module.exports = routes