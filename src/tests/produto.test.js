require("dotenv").config(); 
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST; 
const request = require("supertest"); 
const app = require("../server"); 
const prisma = require("../config/prisma"); 

beforeEach(async () => { 
  await prisma.produto.deleteMany(); 
}); 
 
afterAll(async () => { 
  await prisma.$disconnect(); 
}); 
 
describe("Testes de integração da API de produtos", () => { 
  test("GET /produtos deve retornar status 200", async () => { 
    const response = await request(app).get("/produtos"); 
    expect(response.statusCode).toBe(200); 
    expect(Array.isArray(response.body)).toBe(true); 
  }); 
 
  test("POST /produtos deve criar produto válido", async () => { 
    const response = await request(app) 
      .post("/produtos") 
      .send({ 
        nome: "Teclado", 
        descricao: "USB", 
        preco: 100, 
        quantidade: 5 
      }); 
 
    expect(response.statusCode).toBe(201); 
    expect(response.body.nome).toBe("Teclado"); 
  }); 
 
  test("POST /produtos deve retornar erro com nome vazio", async () => { 
    const response = await request(app) 
      .post("/produtos") 
      .send({ 
        nome: "", 
        descricao: "Teste", 
        preco: 100, 
        quantidade: 5 
      }); 
 
    expect(response.statusCode).toBe(400); 
    expect(response.body.erro).toBe("Nome é obrigatório"); 
  }); 
});