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
 * o estado anterior da tabela Usuario seja 100% preservado.
 */
async function executarComRollback(acao) {
  // Snapshot dos registros existentes antes da execução do teste
  const usuariosAntes = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
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
  const usuariosDepois = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
  expect(usuariosDepois).toEqual(usuariosAntes);
}

describe("Testes de integração com rollback transacional real (Usuario)", () => {
  let usuarioPreExistente;

  beforeAll(async () => {
    // Garante ao menos um registro pré-existente no banco antes dos testes
    // para comprovar que o rollback não exclui nem corrompe dados prévios
    const existentes = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
    if (existentes.length === 0) {
      usuarioPreExistente = await prisma.usuario.create({
        data: {
          nome: "Carlos Eduardo",
          telefone: "11987654321",
          email: "carlos.base@email.com",
          senha: "senhaSegura123",
        },
      });
    } else {
      usuarioPreExistente = existentes[0];
    }
  });

  afterAll(async () => {
    // Se o registro foi criado exclusivamente para a suíte, limpa apenas ele
    if (usuarioPreExistente) {
      await prisma.usuario.delete({ where: { id: usuarioPreExistente.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test("GET /user deve listar usuários dentro da transação preservando dados", async () => {
    await executarComRollback(async () => {
      const response = await request(app).get("/user");

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.some((u) => u.id === usuarioPreExistente.id)).toBe(true);
    });
  });

  test("GET /user/:id deve retornar o usuário correto dentro da transação", async () => {
    await executarComRollback(async () => {
      const response = await request(app).get(`/user/${usuarioPreExistente.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.id).toBe(usuarioPreExistente.id);
      expect(response.body.nome).toBe(usuarioPreExistente.nome);
      expect(response.body.email).toBe(usuarioPreExistente.email);
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

    await executarComRollback(async (tx) => {
      const response = await request(app).post("/user").send(novoUsuario);

      expect(response.statusCode).toBe(201);
      expect(response.body.nome).toBe(novoUsuario.nome);
      expect(response.body.email).toBe(novoUsuario.email);
      expect(response.body.id).toBeDefined();

      idCriado = response.body.id;

      // Confirmação DENTRO da transação: o usuário foi gravado no escopo de tx
      const gravadoNaTx = await tx.usuario.findUnique({
        where: { id: idCriado },
      });
      expect(gravadoNaTx).not.toBeNull();
      expect(gravadoNaTx.nome).toBe(novoUsuario.nome);
    });

    // Confirmação FORA da transação: após o rollback, o registro NÃO existe no banco
    const gravadoAposRollback = await prisma.usuario.findUnique({
      where: { id: idCriado },
    });
    expect(gravadoAposRollback).toBeNull();
  });

  test("POST /user deve rejeitar dados inválidos com status 400", async () => {
    await executarComRollback(async () => {
      const response = await request(app).post("/user").send({
        nome: "",
        telefone: "11912345678",
        email: "email@valido.com",
        senha: "senhaValida",
      });

      expect(response.statusCode).toBe(400);
      expect(response.body.error).toBe("O campo 'nome' é obrigatório.");
    });
  });

  test("PUT /user/:id deve atualizar usuário na transação e restaurar valores no rollback", async () => {
    const nomeOriginal = usuarioPreExistente.nome;
    const telefoneOriginal = usuarioPreExistente.telefone;
    const emailOriginal = usuarioPreExistente.email;
    const senhaOriginal = usuarioPreExistente.senha;

    await executarComRollback(async (tx) => {
      const response = await request(app)
        .put(`/user/${usuarioPreExistente.id}`)
        .send({
          nome: "Carlos Atualizado Temporariamente",
          telefone: "11988887777",
          email: "carlos.alterado@email.com",
          senha: "novaSenha1234",
        });

      expect(response.statusCode).toBe(200);
      expect(response.body.nome).toBe("Carlos Atualizado Temporariamente");
      expect(response.body.email).toBe("carlos.alterado@email.com");

      // Confirmação DENTRO da transação: os dados foram alterados no escopo de tx
      const naTx = await tx.usuario.findUnique({
        where: { id: usuarioPreExistente.id },
      });
      expect(naTx.nome).toBe("Carlos Atualizado Temporariamente");
      expect(naTx.email).toBe("carlos.alterado@email.com");
    });

    // Confirmação FORA da transação: após o rollback, o registro reassume os dados originais
    const restaurado = await prisma.usuario.findUnique({
      where: { id: usuarioPreExistente.id },
    });
    expect(restaurado.nome).toBe(nomeOriginal);
    expect(restaurado.telefone).toBe(telefoneOriginal);
    expect(restaurado.email).toBe(emailOriginal);
    expect(restaurado.senha).toBe(senhaOriginal);
  });

  test("DELETE /user/:id deve excluir usuário na transação e restaurá-lo no rollback", async () => {
    await executarComRollback(async (tx) => {
      const response = await request(app).delete(`/user/${usuarioPreExistente.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.message).toBe("Usuário deletado com sucesso");

      // Confirmação DENTRO da transação: usuário não existe no escopo de tx
      const naTx = await tx.usuario.findUnique({
        where: { id: usuarioPreExistente.id },
      });
      expect(naTx).toBeNull();
    });

    // Confirmação FORA da transação: após o rollback, o usuário excluído voltou a existir intacto
    const restaurado = await prisma.usuario.findUnique({
      where: { id: usuarioPreExistente.id },
    });
    expect(restaurado).not.toBeNull();
    expect(restaurado.id).toBe(usuarioPreExistente.id);
    expect(restaurado.nome).toBe(usuarioPreExistente.nome);
  });

  test("Garante que o rollback de usuário é executado mesmo se o teste falhar", async () => {
    const antes = await prisma.usuario.findMany({ orderBy: { id: "asc" } });

    let erroCapturado = null;
    try {
      await executarComRollback(async () => {
        await request(app).post("/user").send({
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

    // Comprova que a asserção falhou e foi capturada, mas a tabela permaneceu intacta
    expect(erroCapturado).not.toBeNull();
    const depois = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
  });
});

