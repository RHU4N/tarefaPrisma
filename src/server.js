require("dotenv").config();
const express = require("express");
const cors = require("cors");
const prisma = require("./config/prisma");
const { obterTransacao } = require("./config/prisma");
const produtoRoutes = require("./routers/ProdutosRoutes.js");
const usuarioRoutes = require("./routers/UsuarioRoutes.js");
const app = express();

app.use(cors());
app.use(express.json());

// Injeção de dependência do Prisma:
// 1. Transação isolada por requisição (via cabeçalho x-transaction-id)
// 2. Transação associada à aplicação (app.get("prisma")) como fallback
// 3. Cliente padrão do Prisma para execução normal
app.set("prisma", prisma);
app.use((req, res, next) => {
  const txId = req.headers["x-transaction-id"];
  const tx = obterTransacao(txId);
  req.prisma = tx || req.app?.get("prisma") || prisma;
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
if (process.env.NODE_ENV !== "test") {
  app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
  });
}
