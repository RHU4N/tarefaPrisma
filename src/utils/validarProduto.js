function validarProduto(nome, preco, quantidade) {
  if (!nome || nome.trim() === "") {
    return "Nome é obrigatório";
  }
  if (preco === undefined || Number(preco) <= 0) {
    return "Preço deve ser maior que zero";
  }
  if (quantidade === undefined || Number(quantidade) < 0) {
    return "Quantidade não pode ser negativa";
  }
  return null;
}
module.exports = validarProduto;
