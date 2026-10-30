const { PrismaClient } = require("@prisma/client");

// Garante o uso de DATABASE_URL_TEST quando em ambiente de testes
const databaseUrl =
  process.env.NODE_ENV === "test" && process.env.DATABASE_URL_TEST
    ? process.env.DATABASE_URL_TEST
    : process.env.DATABASE_URL;

const prisma = new PrismaClient(
  databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined
);

// Gerenciamento de transações ativas por requisição (isolamento seguro entre testes)
const transacoesAtivas = new Map();

function registrarTransacao(id, tx) {
  if (id && tx) {
    transacoesAtivas.set(id, tx);
  }
}

function removerTransacao(id) {
  if (id) {
    transacoesAtivas.delete(id);
  }
}

function obterTransacao(id) {
  if (!id) return null;
  return transacoesAtivas.get(id) || null;
}

module.exports = prisma;
module.exports.registrarTransacao = registrarTransacao;
module.exports.removerTransacao = removerTransacao;
module.exports.obterTransacao = obterTransacao;
