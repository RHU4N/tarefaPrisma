const prisma = require("../config/prisma");
const validarUsuario = require("../utils/validarUsuario");

function idValido(id) {
  return Number.isInteger(id) && id > 0;
}

exports.listarTodos = async (_req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json(usuarios);
  } catch (error) {
    console.error("Erro ao listar usuários:", error);
    return res.status(500).json({ error: "Erro ao listar usuários" });
  }
};

exports.buscarPorId = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!idValido(id)) return res.status(400).json({ error: "ID inválido" });
    const usuario = await prisma.usuario.findUnique({ where: { id } });
    if (!usuario)
      return res.status(404).json({ error: "Usuário não encontrado" });
    return res.status(200).json(usuario);
  } catch (error) {
    console.error("Erro ao buscar usuário por ID:", error);
    return res.status(500).json({ error: "Erro ao buscar usuário por ID" });
  }
};

exports.criar = async (req, res) => {
  try {
    const { nome, telefone, email, senha } = req.body;
    const erro = validarUsuario(nome, telefone, email, senha);
    if (erro) return res.status(400).json({ error: erro });
    const novoUsuario = await prisma.usuario.create({
      data: {
        nome: nome.trim(),
        telefone: telefone.trim(),
        email: email.trim(),
        senha: senha.trim(),
      },
    });
    return res.status(201).json(novoUsuario);
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
};

exports.atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!idValido(id)) return res.status(400).json({ error: "ID inválido" });
    const usuarioExistente = await prisma.usuario.findUnique({ where: { id } });
    if (!usuarioExistente)
      return res.status(404).json({ error: "Usuário não encontrado" });
    const { nome, telefone, email, senha } = req.body;
    const erro = validarUsuario(nome, telefone, email, senha);
    if (erro) return res.status(400).json({ error: erro });
    const usuarioAtualizado = await prisma.usuario.update({
      where: { id },
      data: {
        nome: nome.trim(),
        telefone: telefone.trim(),
        email: email.trim(),
        senha: senha.trim(),
      },
    });
    return res.status(200).json(usuarioAtualizado);
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return res.status(500).json({ error: "Erro ao atualizar usuário" });
  }
};

exports.deletar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!idValido(id)) return res.status(400).json({ error: "ID inválido" });
    const usuarioExistente = await prisma.usuario.findUnique({ where: { id } });
    if (!usuarioExistente)
      return res.status(404).json({ error: "Usuário não encontrado" });
    await prisma.usuario.delete({ where: { id } });
    return res.status(200).json({ message: "Usuário deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar usuário:", error);
    return res.status(500).json({ error: "Erro ao deletar usuário" });
  }
};
