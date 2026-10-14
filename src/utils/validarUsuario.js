function textoObrigatorio(valor, campo) {
  if (typeof valor !== "string" || valor.trim() === "")
    return `O campo '${campo}' é obrigatório.`;
  return null;
}

function validarUsuario(nome, telefone, email, senha) {
  for (const [valor, campo] of [
    [nome, "nome"],
    [telefone, "telefone"],
    [email, "email"],
    [senha, "senha"],
  ]) {
    const erro = textoObrigatorio(valor, campo);
    if (erro) return erro;
  }
  if (senha.trim().length < 6)
    return "A senha deve ter pelo menos 6 caracteres.";
  if (!/^\S+@\S+\.\S+$/.test(email.trim()))
    return "O campo 'email' deve ser um endereço de e-mail válido.";
  if (!/^\d{10,11}$/.test(telefone.trim()))
    return "O campo 'telefone' deve conter apenas números e ter 10 ou 11 dígitos.";
  return null;
}

module.exports = validarUsuario;
