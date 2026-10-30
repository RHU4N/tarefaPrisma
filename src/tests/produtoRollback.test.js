require("dotenv").config();

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

jest.setTimeout(30000);

class RollbackIntencionalError extends Error {
  constructor() {
    super("Rollback intencional da transação de teste");
    this.name = "RollbackIntencionalError";
  }
}

/**
 * Executa uma ação de teste dentro de uma transação interativa real do Prisma ($transaction).
 * Compartilha o cliente transacional (tx) com o Express para que requisições do Supertest
 * operem na mesma transação. Ao final, força o rollback intencional e garante que
 * o estado anterior da tabela Produto seja 100% preservado.
 */
async function executarComRollback(acao) {
  // Snapshot dos registros existentes antes da execução do teste
  const produtosAntes = await prisma.produto.findMany({ orderBy: { id: "asc" } });
  let erroDoTeste = null;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Injeta o cliente transacional no app Express
        app.set("prisma", tx);
        try {
          await acao(tx);
        } catch (err) {
          // Captura erro de teste legítimo (ex.: falha de asserção do Jest)
          erroDoTeste = err;
          throw err; // Força rollback no Prisma
        } finally {
          // Restaura a instância padrão do Prisma no app
          app.set("prisma", prisma);
        }

        // Se o teste passou, força o rollback intencional para descartar as alterações
        throw new RollbackIntencionalError();
      },
      { maxWait: 10000, timeout: 20000 }
    );
  } catch (erro) {
    if (erro instanceof RollbackIntencionalError || erro.name === "RollbackIntencionalError") {
      // Rollback intencional executado com sucesso
    } else if (erroDoTeste) {
      // Erro legítimo do teste: repassa para o Jest reportar a falha
      throw erroDoTeste;
    } else {
      // Erro inesperado do banco ou da transação
      throw erro;
    }
  } finally {
    app.set("prisma", prisma);
  }

  // Comprova que todos os registros anteriores foram rigorosamente preservados
  const produtosDepois = await prisma.produto.findMany({ orderBy: { id: "asc" } });
  expect(produtosDepois).toEqual(produtosAntes);
}

describe("Testes de integração com rollback transacional real (Produto)", () => {
  let produtoPreExistente;

  beforeAll(async () => {
    // Garante ao menos um registro pré-existente no banco antes dos testes
    // para comprovar que o rollback não exclui nem corrompe dados prévios
    const existentes = await prisma.produto.findMany({ orderBy: { id: "asc" } });
    if (existentes.length === 0) {
      produtoPreExistente = await prisma.produto.create({
        data: {
          nome: "Monitor UltraWide",
          descricao: "IPS 34 polegadas",
          preco: 2499.9,
          quantidade: 5,
        },
      });
    } else {
      produtoPreExistente = existentes[0];
    }
  });

  afterAll(async () => {
    // Se o registro foi criado exclusivamente para a suíte, limpa apenas ele
    if (produtoPreExistente) {
      await prisma.produto.delete({ where: { id: produtoPreExistente.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test("GET /produtos deve listar produtos dentro da transação preservando dados", async () => {
    await executarComRollback(async () => {
      const response = await request(app).get("/produtos");

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.some((p) => p.id === produtoPreExistente.id)).toBe(true);
    });
  });

  test("POST /produtos deve criar produto válido e desfazê-lo após o rollback", async () => {
    let idCriado;
    const novoProduto = {
      nome: "Teclado Mecânico RGB",
      descricao: "Switch Brown",
      preco: 320.0,
      quantidade: 10,
    };

    await executarComRollback(async (tx) => {
      const response = await request(app).post("/produtos").send(novoProduto);

      expect(response.statusCode).toBe(201);
      expect(response.body.nome).toBe(novoProduto.nome);
      expect(response.body.preco).toBe(novoProduto.preco);
      expect(response.body.id).toBeDefined();

      idCriado = response.body.id;

      // Confirmação DENTRO da transação: o produto foi gravado no escopo de tx
      const gravadoNaTx = await tx.produto.findUnique({
        where: { id: idCriado },
      });
      expect(gravadoNaTx).not.toBeNull();
      expect(gravadoNaTx.nome).toBe(novoProduto.nome);
    });

    // Confirmação FORA da transação: após o rollback, o registro NÃO existe no banco
    const gravadoAposRollback = await prisma.produto.findUnique({
      where: { id: idCriado },
    });
    expect(gravadoAposRollback).toBeNull();
  });

  test("POST /produtos deve rejeitar dados inválidos com status 400", async () => {
    await executarComRollback(async () => {
      const response = await request(app).post("/produtos").send({
        nome: "",
        descricao: "Produto Sem Nome",
        preco: 100,
        quantidade: 5,
      });

      expect(response.statusCode).toBe(400);
      expect(response.body.erro).toBe("Nome é obrigatório");
    });
  });

  test("PUT /produtos/:id deve atualizar produto na transação e restaurar valores originais no rollback", async () => {
    const precoOriginal = produtoPreExistente.preco;
    const nomeOriginal = produtoPreExistente.nome;

    await executarComRollback(async (tx) => {
      const response = await request(app)
        .put(`/produtos/${produtoPreExistente.id}`)
        .send({
          nome: "Monitor Atualizado Temporariamente",
          descricao: produtoPreExistente.descricao,
          preco: 9999.99,
          quantidade: produtoPreExistente.quantidade,
        });

      expect(response.statusCode).toBe(200);
      expect(response.body.nome).toBe("Monitor Atualizado Temporariamente");
      expect(response.body.preco).toBe(9999.99);

      // Confirmação DENTRO da transação: os dados foram alterados no escopo de tx
      const naTx = await tx.produto.findUnique({
        where: { id: produtoPreExistente.id },
      });
      expect(naTx.preco).toBe(9999.99);
      expect(naTx.nome).toBe("Monitor Atualizado Temporariamente");
    });

    // Confirmação FORA da transação: após o rollback, o registro reassume os dados originais
    const restaurado = await prisma.produto.findUnique({
      where: { id: produtoPreExistente.id },
    });
    expect(restaurado.preco).toBe(precoOriginal);
    expect(restaurado.nome).toBe(nomeOriginal);
  });

  test("DELETE /produtos/:id deve excluir produto na transação e restaurá-lo no rollback", async () => {
    await executarComRollback(async (tx) => {
      const response = await request(app).delete(`/produtos/${produtoPreExistente.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.mensagem).toBe("Produto deletado com sucesso");

      // Confirmação DENTRO da transação: produto não existe no escopo de tx
      const naTx = await tx.produto.findUnique({
        where: { id: produtoPreExistente.id },
      });
      expect(naTx).toBeNull();
    });

    // Confirmação FORA da transação: após o rollback, o produto excluído voltou a existir intacto
    const restaurado = await prisma.produto.findUnique({
      where: { id: produtoPreExistente.id },
    });
    expect(restaurado).not.toBeNull();
    expect(restaurado.id).toBe(produtoPreExistente.id);
    expect(restaurado.nome).toBe(produtoPreExistente.nome);
  });

  test("Garante que o rollback é executado mesmo se o teste falhar", async () => {
    const antes = await prisma.produto.findMany({ orderBy: { id: "asc" } });

    let erroCapturado = null;
    try {
      await executarComRollback(async () => {
        await request(app).post("/produtos").send({
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

    // Comprova que a asserção falhou e foi capturada, mas a tabela foi 100% preservada
    expect(erroCapturado).not.toBeNull();
    const depois = await prisma.produto.findMany({ orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
  });
});

