const express = require('express')
const routes = express()
const manufactureArticlesController = require('../controllers/manufactureArticles.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',manufactureArticlesController.createmanufactureArticle)
routes.get('/',manufactureArticlesController.fetchmanufactureArticle)
routes.put('/:id',manufactureArticlesController.updatemanufactureArticle)
routes.delete('/:id',manufactureArticlesController.deletemanufactureArticle)
routes.get('/:id',manufactureArticlesController.fetchmanufactureArticleById)

module.exports = routes