const express = require('express');
const router = express.Router();
const produtoController = require('../controllers/ProdutoController');

// Rota para listar todos os produtos
router.get("/", produtoController.listar); 
router.get("/:id", produtoController.buscarPorId); 
router.post("/", produtoController.criar); 
router.put("/:id", produtoController.atualizar); 
router.delete("/:id", produtoController.deletar); 
module.exports = router;