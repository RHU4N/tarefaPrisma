require("dotenv").config();
const express = require("express");
const cors = require("cors");
const produtoRoutes = require("./routers/ProdutosRoutes.js");
const usuarioRoutes = require("./routers/UsuarioRoutes.js");
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.send("API de produtos funcionando");
});
app.use("/produtos", produtoRoutes);
app.use("/user", usuarioRoutes);
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
