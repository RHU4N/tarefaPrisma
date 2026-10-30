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
 * - Registra snapshot inicial da tabela Usuario.
 * - Injeta o cliente transacional por requisição (x-transaction-id) com fallback no app.
 * - Executa a ação HTTP do teste.
 * - Ao concluir com sucesso, força o rollback intencional.
 * - Em caso de falha de asserção, garante o rollback e propaga o erro para o Jest.
 * - Confirma que todos os registros anteriores foram rigorosamente preservados.
 */
async function executarComRollback(acao) {
  const transacaoId = crypto.randomUUID();
  const usuariosAntes = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
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
      const usuariosDepoisFalha = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
      expect(usuariosDepoisFalha).toEqual(usuariosAntes);
      throw erroDoTeste;
    } else {
      throw erro;
    }
  } finally {
    removerTransacao(transacaoId);
    app.set("prisma", prisma);
  }

  // Comprova que todos os registros anteriores foram 100% preservados
  const usuariosDepois = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
  expect(usuariosDepois).toEqual(usuariosAntes);
}

describe("Testes de integração com rollback transacional real (Usuario)", () => {
  afterAll(async () => {
    // Nunca executa deleteMany(), TRUNCATE ou exclusões fora de transações.
    // Todas as fixtures são criadas e revertidas dentro de transações individuais.
    await prisma.$disconnect();
  });

  test("GET /user deve listar usuários dentro da transação preservando dados", async () => {
    await executarComRollback(async (tx, http) => {
      // Fixture criada dentro da transação para garantir conteúdo na lista
      const fixture = await tx.usuario.create({
        data: {
          nome: "Usuario Fixture GET",
          telefone: "11987654321",
          email: "fixture.get@email.com",
          senha: "senhaSegura123",
        },
      });

      const response = await http.get("/user");

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((u) => u.id === fixture.id)).toBe(true);
    });
  });

  test("GET /user/:id deve retornar o usuário correto dentro da transação", async () => {
    await executarComRollback(async (tx, http) => {
      // Fixture criada dentro da própria transação
      const fixture = await tx.usuario.create({
        data: {
          nome: "Usuario Busca ID",
          telefone: "11911112222",
          email: "busca.id@email.com",
          senha: "senhaSegura123",
        },
      });

      const response = await http.get(`/user/${fixture.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.id).toBe(fixture.id);
      expect(response.body.nome).toBe(fixture.nome);
      expect(response.body.email).toBe(fixture.email);
    });
  });

  test("POST /user deve criar usuário válido e desfazê-lo após o rollback", async () => {
    let idCriado;
    const novoUsuario = {
      nome: "Mariana Souza",
      telefone: "11912345678",
      email: "mariana.teste@email.com",
      senha: "minhaSenhaForte",
    };

    await executarComRollback(async (tx, http) => {
      const response = await http.post("/user").send(novoUsuario);

      expect(response.statusCode).toBe(201);
      expect(response.body.nome).toBe(novoUsuario.nome);
      expect(response.body.email).toBe(novoUsuario.email);
      expect(response.body.id).toBeDefined();

      idCriado = response.body.id;

      // Evidência DENTRO da transação: o usuário existe no escopo de tx
      const gravadoNaTx = await tx.usuario.findUnique({
        where: { id: idCriado },
      });
      expect(gravadoNaTx).not.toBeNull();
      expect(gravadoNaTx.nome).toBe(novoUsuario.nome);
    });

    // Evidência FORA da transação: após o rollback, o registro NÃO existe no banco
    const gravadoAposRollback = await prisma.usuario.findUnique({
      where: { id: idCriado },
    });
    expect(gravadoAposRollback).toBeNull();
  });

  test("POST /user deve rejeitar dados inválidos com status 400", async () => {
    await executarComRollback(async (_tx, http) => {
      const response = await http.post("/user").send({
        nome: "",
        telefone: "11912345678",
        email: "email@valido.com",
        senha: "senhaValida",
      });

      expect(response.statusCode).toBe(400);
      expect(response.body.error).toBe("O campo 'nome' é obrigatório.");
    });
  });

  test("PUT /user/:id deve atualizar fixture dentro da transação e restaurar no rollback", async () => {
    let idFixture;

    await executarComRollback(async (tx, http) => {
      // Fixture criada estritamente dentro da transação
      const fixture = await tx.usuario.create({
        data: {
          nome: "Carlos Original",
          telefone: "11988887777",
          email: "carlos.orig@email.com",
          senha: "senhaAntiga123",
        },
      });
      idFixture = fixture.id;

      const response = await http
        .put(`/user/${idFixture}`)
        .send({
          nome: "Carlos Alterado",
          telefone: "11999990000",
          email: "carlos.alterado@email.com",
          senha: "novaSenhaForte",
        });

      expect(response.statusCode).toBe(200);
      expect(response.body.nome).toBe("Carlos Alterado");
      expect(response.body.email).toBe("carlos.alterado@email.com");

      // Evidência DENTRO da transação: os dados foram alterados no escopo de tx
      const naTx = await tx.usuario.findUnique({
        where: { id: idFixture },
      });
      expect(naTx.nome).toBe("Carlos Alterado");
      expect(naTx.email).toBe("carlos.alterado@email.com");
    });

    // Evidência FORA da transação: a fixture inteira foi revertida pelo rollback
    const aposRollback = await prisma.usuario.findUnique({
      where: { id: idFixture },
    });
    expect(aposRollback).toBeNull();
  });

  test("DELETE /user/:id deve excluir fixture dentro da transação e reverter no rollback", async () => {
    let idFixture;

    await executarComRollback(async (tx, http) => {
      // Fixture criada estritamente dentro da transação
      const fixture = await tx.usuario.create({
        data: {
          nome: "Usuario Para Deletar",
          telefone: "11922223333",
          email: "deletar@email.com",
          senha: "senhaDeletar123",
        },
      });
      idFixture = fixture.id;

      const response = await http.delete(`/user/${idFixture}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.message).toBe("Usuário deletado com sucesso");

      // Evidência DENTRO da transação: usuário não existe no escopo de tx
      const naTx = await tx.usuario.findUnique({
        where: { id: idFixture },
      });
      expect(naTx).toBeNull();
    });

    // Evidência FORA da transação: a fixture inteira foi revertida pelo rollback
    const aposRollback = await prisma.usuario.findUnique({
      where: { id: idFixture },
    });
    expect(aposRollback).toBeNull();
  });

  test("Garante que o rollback de usuário é executado mesmo se o teste falhar", async () => {
    const antes = await prisma.usuario.findMany({ orderBy: { id: "asc" } });

    let erroCapturado = null;
    try {
      await executarComRollback(async (_tx, http) => {
        await http.post("/user").send({
          nome: "Usuario Nao Persistido",
          telefone: "11999999999",
          email: "falha@email.com",
          senha: "senhaSegura123",
        });

        // Provoca erro de asserção deliberado
        expect("valor recebido").toBe("valor esperado que causará falha");
      });
    } catch (err) {
      erroCapturado = err;
    }

    // Comprova que a asserção falhou e foi capturada, mas a tabela permaneceu 100% intacta
    expect(erroCapturado).not.toBeNull();
    const depois = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
  });
});
