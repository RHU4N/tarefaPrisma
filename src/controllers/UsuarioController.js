const prisma = require("../config/prisma");

//Listar Todos
exports.listarTodos = async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({ orderBy: { id: "asc" } });
    res.status(200).json(usuarios);
  } catch (error) {
    console.error("Erro ao listar usuários:", error);
    res.status(500).json({ error: "Erro ao listar usuários" });
  }
};

//bUSCAR POR ID
exports.buscarPorId = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: id },
    });

    if (!usuario) {
      return res.status(404).json({
        error: "Usuário não encontrado",
      });
    }

    res.status(200).json(usuario);
  } catch (error) {
    console.error("Erro ao buscar usuário por ID:", error);
    res.status(500).json({ error: "Erro ao buscar usuário por ID" });
  }
};

//Criar
exports.criar = async (req, res) => {
  try {
    const { nome, telefone, email, senha } = req.body;
    if (!nome || nome.trim() === "") {
      return res.status(400).json({ error: "O campo 'nome' é obrigatório." });
    }
    if (!telefone || telefone.trim() === "") {
      return res
        .status(400)
        .json({ error: "O campo 'telefone' é obrigatório." });
    }
    if (!email || email.trim() === "") {
      return res.status(400).json({ error: "O campo 'email' é obrigatório." });
    }
    if (!senha || senha.trim() === "") {
      return res.status(400).json({ error: "O campo 'senha' é obrigatório." });
    }
    if (senha.length < 6) {
      return res
        .status(400)
        .json({ error: "A senha deve ter pelo menos 6 caracteres." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        error: "O campo 'email' deve ser um endereço de e-mail válido.",
      });
    }
    if (!/^\d{10,11}$/.test(telefone)) {
      return res.status(400).json({
        error:
          "O campo 'telefone' deve conter apenas números e ter 10 ou 11 dígitos.",
      });
    }

    const novoUsuario = await prisma.usuario.create({
      data: {
        nome: nome.trim(),
        telefone: telefone.trim(),
        email: email.trim(),
        senha: senha.trim(),
      },
    });

    res.status(201).json(novoUsuario);
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
};

//Atualizar
exports.atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, telefone, email, senha } = req.body;
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { id: id },
    });
    if (!usuarioExistente) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    if (!nome || nome.trim() === "") {
      return res.status(400).json({ error: "O campo 'nome' é obrigatório." });
    }
    if (!telefone || telefone.trim() === "") {
      return res
        .status(400)
        .json({ error: "O campo 'telefone' é obrigatório." });
    }
    if (!email || email.trim() === "") {
      return res.status(400).json({ error: "O campo 'email' é obrigatório." });
    }
    if (!senha || senha.trim() === "") {
      return res.status(400).json({ error: "O campo 'senha' é obrigatório." });
    }
    if (senha.length < 6) {
      return res
        .status(400)
        .json({ error: "A senha deve ter pelo menos 6 caracteres." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        error: "O campo 'email' deve ser um endereço de e-mail válido.",
      });
    }
    if (!/^\d{10,11}$/.test(telefone)) {
      return res.status(400).json({
        error:
          "O campo 'telefone' deve conter apenas números e ter 10 ou 11 dígitos.",
      });
    }

    const usuarioAtualizado = await prisma.usuario.update({
      where: { id: id },
      data: {
        nome: nome.trim(),
        telefone: telefone.trim(),
        email: email.trim(),
        senha: senha.trim(),
      },
    });

    res.status(200).json(usuarioAtualizado);
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    res.status(500).json({ error: "Erro ao atualizar usuário" });
  }
};

//Deletar
exports.deletar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { id: id },
    });
    if (!usuarioExistente) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    await prisma.usuario.delete({
      where: { id: id },
    });

    res.status(200).json({ message: "Usuário deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar usuário:", error);
    res.status(500).json({ error: "Erro ao deletar usuário" });
  }
};
