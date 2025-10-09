const express = require('express')
const routes = express()
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.get('/',dashboardController.fetchdashboard)
routes.get('/activity',dashboardController.fetchdashboardRecentActivity)
routes.get('/pending-approval',dashboardController.fetchPendingApprovalController)

module.exports = routes