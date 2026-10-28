const request = require('supertest');
const app = require('../server');

describe('Testes da API de Produtos', () => {
    test("GET /produtos - Deve retornar status 200", async () => {
        const response = await request(app).get('/produtos');
        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    test("POST /produtos - Deve criar um novo produto", async () => {
        const novoProduto = {
            nome: "Teclado",
            descricao: "USB sem fio",
            preco: 100.99,
            quantidade: 5
        };
        const response = await request(app).post('/produtos').send(novoProduto);
        expect(response.statusCode).toBe(201);
        expect(response.body.nome).toBe(novoProduto.nome);
    });

    test("POST /produtos - Deve retornar erro se o nome estiver vazio", async () => {
        const novoProduto = {
            nome: "",
            descricao: "USB sem fio",
            preco: 100.99,
            quantidade: 5
        };
        const response = await request(app).post('/produtos').send(novoProduto);
        expect(response.statusCode).toBe(400);
        expect(response.body.erro).toBe("Nome é obrigatório");
    });

    test("POST /produtos - Deve retornar erro se o preço for menor ou igual a zero", async () => {
        const novoProduto = {
            nome: "Teclado",
            descricao: "USB sem fio",
            preco: 0,
            quantidade: 5
        };
        const response = await request(app).post('/produtos').send(novoProduto);
        expect(response.statusCode).toBe(400);
        expect(response.body.erro).toBe("Preço deve ser maior que zero");
    });

    test("POST /produtos - Deve retornar erro se a quantidade for negativa", async () => {
        const novoProduto = {
            nome: "Teclado",
            descricao: "USB sem fio",
            preco: 100.99,
            quantidade: -1
        };
        const response = await request(app).post('/produtos').send(novoProduto);
        expect(response.statusCode).toBe(400);
        expect(response.body.erro).toBe("Quantidade não pode ser negativa");
    });


});