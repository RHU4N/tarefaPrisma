require("dotenv").config();

// Nunca executar testes de escrita no mesmo banco usado pela aplicação.
const bancoPrincipal = process.env.DATABASE_URL;
const bancoTeste = process.env.DATABASE_URL_TEST;

if (!bancoTeste) {
  throw new Error("Configure DATABASE_URL_TEST no .env antes de executar a integração.");
}

if (bancoPrincipal) {
  const principal = new URL(bancoPrincipal);
  const teste = new URL(bancoTeste);
  if (principal.host === teste.host && principal.pathname === teste.pathname) {
    throw new Error("DATABASE_URL_TEST deve apontar para outro banco de dados.");
  }
}

process.env.DATABASE_URL = bancoTeste;

// O controller importa o Prisma de src/config/prisma. Este mock redireciona
// suas operações para a transação ativa durante cada teste do Supertest.
// A aplicação continua exercendo as rotas, validações e consultas reais.
jest.mock("../config/prisma", () => {
  const { PrismaClient } = require("@prisma/client");
  const cliente = new PrismaClient();
  let transacao = null;

  return new Proxy(cliente, {
    get(alvo, propriedade) {
      if (propriedade === "__clienteOriginal") return cliente;
      if (propriedade === "__usarTransacao") {
        return (tx) => { transacao = tx; };
      }

      const ativo = transacao || alvo;
      const valor = ativo[propriedade];
      return typeof valor === "function" ? valor.bind(ativo) : valor;
    },
  });
});

const request = require("supertest");
const app = require("../server");
const prisma = require("../config/prisma");

jest.setTimeout(30000);
const ROLLBACK = new Error("Rollback intencional dos dados de teste");

// Todas as operações de cada teste são feitas na mesma transação real.
// Forçamos um erro ao fim para o Prisma executar ROLLBACK (não COMMIT).
// Uma falha de asserção também aborta a transação e continua falhando o teste.
async function executarComRollback(acao) {
  const cliente = prisma.__clienteOriginal;
  const antes = await cliente.produto.findMany({ orderBy: { id: "asc" } });
  let falha = null;

  try {
    await cliente.$transaction(async (tx) => {
      prisma.__usarTransacao(tx);
      try {
        await acao();
        throw ROLLBACK;
      } finally {
        prisma.__usarTransacao(null);
      }
    }, { maxWait: 10000, timeout: 20000 });
  } catch (erro) {
    if (erro !== ROLLBACK) falha = erro;
  }

  // Evidência automatizada: os produtos antes e depois são idênticos.
  const depois = await cliente.produto.findMany({ orderBy: { id: "asc" } });
  expect(depois).toEqual(antes);
  if (falha) throw falha;
}

afterAll(async () => {
  await prisma.__clienteOriginal.$disconnect();
});

describe("Integração da API de produtos com rollback", () => {
  test("GET /produtos retorna 200", async () => {
    await executarComRollback(async () => {
      const resposta = await request(app).get("/produtos");
      expect(resposta.statusCode).toBe(200);
      expect(Array.isArray(resposta.body)).toBe(true);
    });
  });

  test("POST /produtos cria um produto e desfaz a inserção", async () => {
    await executarComRollback(async () => {
      const resposta = await request(app).post("/produtos").send({
        nome: "Teclado",
        descricao: "USB",
        preco: 100,
        quantidade: 5,
      });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.body.nome).toBe("Teclado");
      const gravado = await prisma.produto.findUnique({
        where: { id: resposta.body.id },
      });
      expect(gravado).not.toBeNull();
    });
  });

  test("POST /produtos rejeita nome vazio", async () => {
    await executarComRollback(async () => {
      const resposta = await request(app).post("/produtos").send({
        nome: "",
        descricao: "Teste",
        preco: 100,
        quantidade: 5,
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body.erro).toBe("Nome é obrigatório");
    });
  });

  test("PUT /produtos/:id atualiza dentro da transação", async () => {
    await executarComRollback(async () => {
      const criado = await prisma.produto.create({
        data: { nome: "Mouse", descricao: "USB", preco: 50, quantidade: 2 },
      });

      const resposta = await request(app).put(`/produtos/${criado.id}`).send({
        nome: "Mouse sem fio",
        descricao: "Bluetooth",
        preco: 80,
        quantidade: 3,
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.body.nome).toBe("Mouse sem fio");
      const atualizado = await prisma.produto.findUnique({ where: { id: criado.id } });
      expect(atualizado.preco).toBe(80);
    });
  });

  test("DELETE /produtos/:id remove apenas dentro da transação", async () => {
    await executarComRollback(async () => {
      const criado = await prisma.produto.create({
        data: { nome: "Monitor", descricao: "HDMI", preco: 500, quantidade: 1 },
      });

      const resposta = await request(app).delete(`/produtos/${criado.id}`);
      expect(resposta.statusCode).toBe(200);
      expect(await prisma.produto.findUnique({ where: { id: criado.id } })).toBeNull();
    });
  });
});
