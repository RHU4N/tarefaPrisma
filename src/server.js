require("dotenv").config();
const express = require("express");
const cors = require("cors");
const prisma = require("./config/prisma");
const produtoRoutes = require("./routers/ProdutosRoutes.js");
const usuarioRoutes = require("./routers/UsuarioRoutes.js");
const app = express();
app.use(cors());
app.use(express.json());

// Injeção de dependência do Prisma: permite que testes compartilhem cliente transacional
app.set("prisma", prisma);
app.use((req, res, next) => {
  req.prisma = app.get("prisma") || prisma;
  next();
});

app.get("/", (req, res) => {
  res.send("API de produtos funcionando");
});
app.use("/produtos", produtoRoutes);
app.use("/user", usuarioRoutes);

// Exporta o app para que possa ser usado em outros arquivos, como em testes
module.exports = app;

// Inicia o servidor apenas se não estiver em ambiente de teste
if(process.env.NODE_ENV !== "test") {
  app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
  });
}
