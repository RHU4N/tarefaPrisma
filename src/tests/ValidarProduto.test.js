const validarProduto = require("../utils/validarProduto");
test("deve retornar null para dados válidos", () => {
  const resultado = validarProduto("Mouse", 100, 10);
  expect(resultado).toBe(null);
});
test("deve retornar erro se nome estiver vazio", () => {
  const resultado = validarProduto("", 100, 10);
  expect(resultado).toBe("Nome é obrigatório");
});
test("deve retornar erro se preço for menor ou igual a zero", () => {
  const resultado = validarProduto("Mouse", 0, 10);
  expect(resultado).toBe("Preço deve ser maior que zero");
});
test("deve retornar erro se quantidade for negativa", () => {
  const resultado = validarProduto("Mouse", 100, -1);
  expect(resultado).toBe("Quantidade não pode ser negativa");
});

//nome com espaços
test("Deve tirar os espaços do nome", () => {
  const resultado = validarProduto("Mouse   ", 100, 10);
  expect(resultado).toBe(null);
});

//preço negativo
test("Deve retornar erro se preço for negativo", () => {
  const resultado = validarProduto("Mouse", -100, 10);
  expect(resultado).toBe("Preço deve ser maior que zero");
});

//quantidade zero
test("Deve retornar null se quantidade for zero", () => {
  const resultado = validarProduto("Mouse", 100, 0);
  expect(resultado).toBe(null);
});

