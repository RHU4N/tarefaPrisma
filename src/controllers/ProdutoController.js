const prisma = require("../config/prisma");
const validarProduto = require("../utils/validarProduto");

// LISTAR TODOS
exports.listar = async (req, res) => {
  try {
    const produtos = await prisma.produto.findMany({
      orderBy: { id: "asc" },
    });
    res.status(200).json(produtos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
};

// BUSCAR POR ID
exports.buscarPorId = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    const produto = await prisma.produto.findUnique({
      where: { id },
    });
    if (!produto) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    res.status(200).json(produto);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar produto" });
  }
};

// CRIAR
exports.criar = async (req, res) => {
  try {
    const { nome, descricao, preco, quantidade } = req.body;

    const erro = validarProduto(nome, preco, quantidade);

    if (erro) {
      return res.status(400).json({ erro });
    }

    const novoProduto = await prisma.produto.create({
      data: {
        nome: nome.trim(),
        descricao: descricao ? descricao.trim() : null,
        preco: Number(preco),
        quantidade: Number(quantidade),
      },
    });

    res.status(201).json(novoProduto);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao criar produto" });
  }
};

// ATUALIZAR
exports.atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, descricao, preco, quantidade } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    const produtoExistente = await prisma.produto.findUnique({
      where: { id },
    });

    if (!produtoExistente) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    const erro = validarProduto(nome, preco, quantidade);

    if (erro) {
      return res.status(400).json({ erro });
    }

    const produtoAtualizado = await prisma.produto.update({
      where: { id },
      data: {
        nome: nome.trim(),
        descricao: descricao ? descricao.trim() : null,
        preco: Number(preco),
        quantidade: Number(quantidade),
      },
    });

    res.status(200).json(produtoAtualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao atualizar produto" });
  }
};

// DELETAR
exports.deletar = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    const produtoExistente = await prisma.produto.findUnique({
      where: { id },
    });

    if (!produtoExistente) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    await prisma.produto.delete({
      where: { id },
    });
    res.status(200).json({ mensagem: "Produto deletado com sucesso" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao deletar produto" });
  }
};
