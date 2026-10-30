require("dotenv").config();
const crypto = require("crypto");

// 1. SEGURANÇA: validação rigorosa dos bancos de dados
const bancoPrincipal = process.env.DATABASE_URL;
const bancoTeste = process.env.DATABASE_URL_TEST;

if (!bancoTeste) {
  throw new Error(
    "Configure DATABASE_URL_TEST no arquivo .env antes de executar os testes de integração."
  );
}

if (bancoPrincipal) {
  const urlPrincipal = new URL(bancoPrincipal);
  const urlTeste = new URL(bancoTeste);
  if (
    urlPrincipal.host === urlTeste.host &&
    urlPrincipal.pathname === urlTeste.pathname
  ) {
    throw new Error(
      "Por segurança, DATABASE_URL_TEST deve apontar para um banco diferente de DATABASE_URL."
    );
  }
}

// Configura explicitamente o ambiente para o banco de dados de teste
process.env.DATABASE_URL = bancoTeste;

const request = require("supertest");
const app = require("../server");
const prisma = require("../config/prisma");
const { registrarTransacao, removerTransacao } = require("../config/prisma");

jest.setTimeout(30000);

class RollbackIntencionalError extends Error {
  constructor() {
    super("Rollback intencional da transação de teste");
    this.name = "RollbackIntencionalError";
  }
}

/**
 * Cria cliente HTTP isolado por requisição associando o ID da transação
 * através do cabeçalho x-transaction-id, evitando concorrência e estado global.
 */
function criarClienteHttp(appInstance, transacaoId) {
  return {
    get: (url) => request(appInstance).get(url).set("x-transaction-id", transacaoId),
    post: (url) => request(appInstance).post(url).set("x-transaction-id", transacaoId),
    put: (url) => request(appInstance).put(url).set("x-transaction-id", transacaoId),
    delete: (url) => request(appInstance).delete(url).set("x-transaction-id", transacaoId),
  };
}

/**
 * Executa uma ação de teste dentro de uma transação interativa real do Prisma ($transaction).
 * - Registra snapshot inicial da tabela Produto.
 * - Injeta o cliente transacional por requisição (x-transaction-id) com fallback no app.
 * - Executa a ação HTTP do teste.
 * - Ao concluir com sucesso, força o rollback intencional.
 * - Em caso de falha de asserção, garante o rollback e propaga o erro para o Jest.
 * - Confirma que todos os registros anteriores foram rigorosamente preservados.
 */
async function executarComRollback(acao) {
  const transacaoId = crypto.randomUUID();
  const produtosAntes = await prisma.produto.findMany({ orderBy: { id: "asc" } });
  let erroDoTeste = null;

  try {
    await prisma.$transaction(
      async (tx) => {
        registrarTransacao(transacaoId, tx);
        app.set("prisma", tx);
        try {
          const http = criarClienteHttp(app, transacaoId);
          await acao(tx, http);
        } catch (err) {
          erroDoTeste = err;
          throw err; // Força rollback no Prisma
        } finally {
          removerTransacao(transacaoId);
          app.set("prisma", prisma);
        }

        // Se o teste passou pelas asserções, força o rollback intencional
        throw new RollbackIntencionalError();
      },
      { maxWait: 10000, timeout: 20000 }
    );
  } catch (erro) {
    if (erro instanceof RollbackIntencionalError || erro.name === "RollbackIntencionalError") {
      // Rollback intencional esperado
    } else if (erroDoTeste) {
      // Comprova que mesmo na falha do teste o rollback preservou o banco
      const produtosDepoisFalha = await prisma.produto.findMany({ orderBy: { id: "asc" } });
      expect(produtosDepoisFalha).toEqual(produtosAntes);
      throw erroDoTeste;
    } else {
      throw erro;
    }
  } finally {
    removerTransacao(transacaoId);
    app.set("prisma", prisma);
  }

  // Comprova que todos os registros anteriores foram 100% preservados
  const produtosDepois = await prisma.produto.findMany({ orderBy: { id: "asc" } });
  expect(produtosDepois).toEqual(produtosAntes);
}

describe("Testes de integração com rollback transacional real (Produto)", () => {
  afterAll(async () => {
    // Nunca executa deleteMany(), TRUNCATE ou exclusões fora de transações.
    // Todas as fixtures são criadas e revertidas dentro de transações individuais.
    await prisma.$disconnect();
  });

  test("GET /produtos deve listar produtos dentro da transação preservando dados", async () => {
    await executarComRollback(async (tx, http) => {
      // Fixture criada dentro da própria transação para garantir que a lista não esteja vazia
      const fixture = await tx.produto.create({
        data: {
          nome: "Produto Fixture GET",
          descricao: "Criado dentro da transacao",
          preco: 50.0,
          quantidade: 1,
        },
      });

      const response = await http.get("/produtos");

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((p) => p.id === fixture.id)).toBe(true);
    });
  });

  test("POST /produtos deve criar produto válido dentro da transação e desfazê-lo após o rollback", async () => {
    let idCriado;
    const novoProduto = {
      nome: "Teclado Mecânico RGB",
      descricao: "Switch Brown",
      preco: 320.0,
      quantidade: 10,
    };

    await executarComRollback(async (tx, http) => {
      const response = await http.post("/produtos").send(novoProduto);

      expect(response.statusCode).toBe(201);
      expect(response.body.nome).toBe(novoProduto.nome);
      expect(response.body.preco).toBe(novoProduto.preco);
      expect(response.body.id).toBeDefined();

      idCriado = response.body.id;

      // Evidência DENTRO da transação: o produto existe no escopo de tx
      const gravadoNaTx = await tx.produto.findUnique({
        where: { id: idCriado },
      });
      expect(gravadoNaTx).not.toBeNull();
      expect(gravadoNaTx.nome).toBe(novoProduto.nome);
    });

    // Evidência FORA da transação: após o rollback, o registro NÃO existe no banco
    const gravadoAposRollback = await prisma.produto.findUnique({
      where: { id: idCriado },
    });
    expect(gravadoAposRollback).toBeNull();
  });

  test("POST /produtos deve rejeitar dados inválidos com status 400", async () => {
    await executarComRollback(async (_tx, http) => {
      const response = await http.post("/produtos").send({
        nome: "",
        descricao: "Produto Sem Nome",
        preco: 100,
        quantidade: 5,
      });

      expect(response.statusCode).toBe(400);
      expect(response.body.erro).toBe("Nome é obrigatório");
    });
  });

  test("PUT /produtos/:id deve atualizar fixture dentro da transação e revertê-la no rollback", async () => {
    let idFixture;
    const precoOriginal = 150.0;
    const nomeOriginal = "Mouse Gamer Fixture";

    await executarComRollback(async (tx, http) => {
      // Fixture criada estritamente dentro da transação
      const fixture = await tx.produto.create({
        data: {
          nome: nomeOriginal,
          descricao: "Optico USB",
          preco: precoOriginal,
          quantidade: 8,
        },
      });
      idFixture = fixture.id;

      const response = await http
        .put(`/produtos/${idFixture}`)
        .send({
          nome: "Mouse Gamer Alterado",
          descricao: "Bluetooth",
          preco: 299.99,
          quantidade: 12,
        });

      expect(response.statusCode).toBe(200);
      expect(response.body.nome).toBe("Mouse Gamer Alterado");
      expect(response.body.preco).toBe(299.99);

      // Evidência DENTRO da transação: os dados foram alterados no escopo de tx
      const naTx = await tx.produto.findUnique({
        where: { id: idFixture },
      });
      expect(naTx.nome).toBe("Mouse Gamer Alterado");
      expect(naTx.preco).toBe(299.99);
    });

    // Evidência FORA da transação: a fixture inteira foi revertida pelo rollback
    const aposRollback = await prisma.produto.findUnique({
      where: { id: idFixture },
    });
    expect(aposRollback).toBeNull();
  });

  test("DELETE /produtos/:id deve excluir fixture dentro da transação e revertê-la no rollback", async () => {
    let idFixture;

    await executarComRollback(async (tx, http) => {
      // Fixture criada estritamente dentro da transação
      const fixture = await tx.produto.create({
        data: {
          nome: "Produto Para Excluir",
          descricao: "Temporario na tx",
          preco: 80.0,
          quantidade: 2,
        },
      });
      idFixture = fixture.id;

      const response = await http.delete(`/produtos/${idFixture}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.mensagem).toBe("Produto deletado com sucesso");

      // Evidência DENTRO da transação: fixture não existe mais no escopo de tx
      const naTx = await tx.produto.findUnique({
        where: { id: idFixture },
      });
      expect(naTx).toBeNull();
    });

    // Evidência FORA da transação: a criação e exclusão da fixture foram revertidas
    const aposRollback = await prisma.produto.findUnique({
      where: { id: idFixture },
    });
    expect(aposRollback).toBeNull();
  });

  test("Garante que o rollback é executado mesmo se o teste falhar", async () => {
    const antes = await prisma.produto.findMany({ orderBy: { id: "asc" } });

    let erroCapturado = null;
    try {
      await executarComRollback(async (_tx, http) => {
        await http.post("/produtos").send({
          nome: "Produto Não Persistido",
          descricao: "Falha intencional",
          preco: 50.0,
          quantidade: 1,
        });

        // Provoca erro de asserção deliberado
        expect("valor recebido").toBe("valor esperado que causará falha");
      });
    } catch (err) {
      erroCapturado = err;
    }

    // Comprova que a asserção falhou e foi capturada, mas a tabela permaneceu 100% intacta
    expect(erroCapturado).not.toBeNull();
    const depois = await prisma.produto.findMany({ orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
  });
});
