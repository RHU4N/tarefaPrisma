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

// Injeção de dependência do Prisma por requisição:
// - Em ambiente de testes (NODE_ENV=test), inspeciona o cabeçalho x-transaction-id.
// - Se o cabeçalho for informado, associa o cliente transacional correspondente ou rejeita se for inválido/expirado.
// - Em ambiente normal ou sem cabeçalho, utiliza exclusivamente o Prisma padrão.
// - Não há estado global compartilhado (sem app.set("prisma", tx)).
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "test") {
    const txId = req.headers["x-transaction-id"];
    if (txId) {
      const tx = obterTransacao(txId);
      if (!tx) {
        return res.status(500).json({
          erro: "Transação de teste não encontrada ou expirada.",
        });
      }
      req.prisma = tx;
      return next();
    }
  }

  req.prisma = prisma;
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
