require("dotenv").config();
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
const request = require("supertest");
const app = require("../server");
const prisma = require("../config/prisma");

beforeEach(async () => {
  await prisma.usuario.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Testes de integração da API de usuários", () => {
  test("GET /user deve retornar status 200", async () => {
    const response = await request(app).get("/user");
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test("POST /user deve criar usuário válido", async () => {
    const response = await request(app)
      .post("/user")
      .send({
        nome: "Ana Silva",
        telefone: "11987654321",
        email: "ana@email.com",
        senha: "senha123",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.nome).toBe("Ana Silva");
  });

  test("POST /user deve retornar erro com nome vazio", async () => {
    const response = await request(app)
      .post("/user")
      .send({
        nome: "",
        telefone: "11987654321",
        email: "ana@email.com",
        senha: "senha123",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe("O campo 'nome' é obrigatório.");
  });
});

