const validarUsuario = require("../utils/validarUsuario");
const dadosValidos = ["Ana Silva", "11987654321", "ana@email.com", "senha123"];

describe("validarUsuario", () => {
  test("aceita dados válidos", () =>
    expect(validarUsuario(...dadosValidos)).toBeNull());
  test.each([
    [0, "O campo 'nome' é obrigatório."],
    [1, "O campo 'telefone' é obrigatório."],
    [2, "O campo 'email' é obrigatório."],
    [3, "O campo 'senha' é obrigatório."],
  ])("rejeita campo obrigatório vazio (posição %i)", (posicao, mensagem) => {
    const dados = [...dadosValidos];
    dados[posicao] = "";
    expect(validarUsuario(...dados)).toBe(mensagem);
  });
  test("rejeita senha curta", () =>
    expect(validarUsuario("Ana", "11987654321", "ana@email.com", "12345")).toBe(
      "A senha deve ter pelo menos 6 caracteres.",
    ));
  test("rejeita e-mail inválido", () =>
    expect(validarUsuario("Ana", "11987654321", "invalido", "senha123")).toBe(
      "O campo 'email' deve ser um endereço de e-mail válido.",
    ));
  test.each(["1198765432", "11987654321"])("aceita telefone %s", (telefone) =>
    expect(
      validarUsuario("Ana", telefone, "ana@email.com", "senha123"),
    ).toBeNull(),
  );
  test("rejeita telefone inválido", () =>
    expect(
      validarUsuario("Ana", "(11) 98765-4321", "ana@email.com", "senha123"),
    ).toBe(
      "O campo 'telefone' deve conter apenas números e ter 10 ou 11 dígitos.",
    ));
  test("rejeita valor que não é texto", () =>
    expect(
      validarUsuario(123, "11987654321", "ana@email.com", "senha123"),
    ).toBe("O campo 'nome' é obrigatório."));
});
