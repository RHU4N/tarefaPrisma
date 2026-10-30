# API Prisma — atividade de usuários e testes

## Entrega realizada

A API possui a tabela/modelo `Usuario`, com os campos `id`, `nome`, `telefone`,
`email` e `senha`. A migration correspondente está em
`prisma/migrations/20260828111421_init/migration.sql`.

O CRUD está exposto pelo servidor em `/user`:

| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/user` | Lista usuários |
| GET | `/user/:id` | Busca um usuário |
| POST | `/user` | Cria um usuário |
| PUT | `/user/:id` | Atualiza um usuário |
| DELETE | `/user/:id` | Exclui um usuário |

As regras de entrada foram retiradas do controller e centralizadas em
`src/utils/validarUsuario.js`. O controller chama a validação antes de gravar
os dados, evitando duplicação entre criar e atualizar.

## Testes automatizados (Jest)

Os testes unitários ficam em `src/tests/validarUsuario.test.js` e `src/tests/ValidarProduto.test.js`.

Para executar os testes com isolamento e segurança:

```bash
# Testes unitários de validação (sem conexão a banco)
npm run test:unit

# Testes de integração com rollback transacional (não destrutivos, preservam dados pré-existentes)
npm run test:rollback

# Testes de integração legados com limpeza (DESTRUTIVOS: executam deleteMany() no banco de testes)
npm run test:clean

# Execução segura padrão recomendada (unitários + rollback, sem apagar registros existentes)
npm test

# Executa todas as suítes (ATENÇÃO: inclui os testes legados com deleteMany(), apagando dados do banco de testes)
npm run test:all
```

## Roteiro manual — Insomnia ou Thunder Client

1. Inicie a API com `npm run dev`.
2. Crie um `POST http://localhost:3000/user` com JSON:

```json
{
  "nome": "Ana Silva",
  "telefone": "11987654321",
  "email": "ana@email.com",
  "senha": "senha123"
}
```

   Resultado esperado: `201 Created` e o usuário com `id`.
3. Faça `GET http://localhost:3000/user` e confirme que o usuário está na
   lista (`200 OK`).
4. Faça `GET http://localhost:3000/user/1` (substitua `1` pelo id retornado)
   e espere `200 OK`.
5. Faça `PUT http://localhost:3000/user/1` com o mesmo JSON, alterando o
   nome. Resultado esperado: `200 OK`.
6. Valide a regra fazendo um `POST` com `"email": "invalido"`. Resultado
   esperado: `400 Bad Request` e a mensagem de e-mail inválido.
7. Faça `DELETE http://localhost:3000/user/1`. Resultado esperado: `200 OK`.

## A2 — Testes com Rollback

Esta seção documenta a arquitetura de testes de integração com rollback transacional real utilizando o Prisma ORM e o Supertest, localizados em `src/tests/produtoRollback.test.js` (Produtos) e `src/tests/usuarioRollback.test.js` (Usuários).

---

### 1. Diferença entre limpeza (`deleteMany`) e rollback transacional

| Aspecto | Limpeza Manual (`deleteMany()`) | Rollback Transacional (`$transaction()`) |
| :--- | :--- | :--- |
| **Comportamento** | Executa `DELETE FROM tabela` via DML antes ou depois do teste. | Inicia uma transação com `START TRANSACTION` e emite `ROLLBACK` ao final. |
| **Dados pré-existentes** | São **destruídos permanentemente** a cada teste executado. | São **preservados**: a tabela retorna ao estado exato do snapshot inicial. |
| **Alterações (`UPDATE`)** | Não reverte o dado modificado para o valor original; apaga tudo. | Reverte valores alterados de volta aos valores originais via *undo log*. |
| **Exclusões (`DELETE`)** | Não restaura registros excluídos durante o teste. | Restaura os registros excluídos de volta ao banco. |
| **Falha no teste** | Se a asserção falhar, a tabela pode ficar parcialmente corrompida. | O rollback é executado automaticamente, mesmo se uma asserção falhar. |
| **I/O e Desempenho** | Lento devido a sucessivas gravações e deleções físicas em disco. | Rápido, aproveitando buffers de memória e undo logs da engine. |

---

### 2. Como o Prisma utiliza o `$transaction()`

O Prisma ORM disponibiliza o recurso de **transações interativas**:
```javascript
await prisma.$transaction(async (tx) => {
  // tx é uma instância exclusiva ligada à conexão aberta para esta transação
  await tx.produto.create({ ... });
  // Se a função lançar uma exceção, o Prisma envia ROLLBACK ao MySQL.
  // Se concluir normalmente, envia COMMIT.
}, { maxWait: 10000, timeout: 20000 });
```

Para implementar o rollback sem comitar dados de teste, adota-se a técnica de **rollback intencional**:
- Ao final das asserções válidas do teste, a função lança propositalmente uma exceção controlada (`RollbackIntencionalError`).
- O Prisma intercepta a exceção e emite o comando `ROLLBACK` ao MySQL.
- O helper de teste trata o erro intencional como condição de sucesso e confirma que os registros pós-teste coincidem com os pré-teste.

---

### 3. Compartilhamento da transação com Supertest por requisição

Em testes de integração com Supertest, as requisições HTTP atingem a aplicação Express de forma desacoplada da chamada do teste.

Para associar a requisição HTTP à transação sem recorrer a estado global compartilhado:
1. Em `src/config/prisma.js`, é mantido um registro em memória (`Map`) que associa um UUID único ao cliente transacional `tx`:
   - `registrarTransacao(id, tx)`
   - `obterTransacao(id)`
   - `removerTransacao(id)`
2. O helper de teste gera um UUID (`transacaoId`) para cada teste e configura o cliente HTTP para enviar o cabeçalho:
   ```http
   x-transaction-id: <transacaoId>
   ```
3. O middleware em `src/server.js` extrai o cabeçalho e injeta o cliente transacional na requisição:
   ```javascript
   req.prisma = tx;
   ```
4. Os controllers acessam `req.prisma`, executando todas as consultas no escopo da transação ativa.

---

### 4. Isolamento por UUID e Segurança contra Vazamento

- **Exclusividade em ambiente de teste:** O cabeçalho `x-transaction-id` é interpretado **somente** quando `process.env.NODE_ENV === "test"`. Em produção ou desenvolvimento, cabeçalhos externos são ignorados e a aplicação utiliza exclusivamente o Prisma padrão.
- **Rejeição de identificadores inválidos:** No ambiente de teste, se uma requisição fornecer um identificador inexistente ou expirado, ela é rejeitada imediatamente com status `500` (`Transação de teste não encontrada ou expirada.`). Isso impede que requisições de teste realizem gravações acidentais no banco fora da transação.
- **Limpeza no bloco `finally`:** O identificador da transação é removido do `Map` no bloco `finally` de `executarComRollback`, prevenindo vazamento de conexões ou transações órfãs mesmo em caso de erro grave.
- **Ausência de estado global:** Não é utilizado `app.set("prisma", tx)` nem variáveis globais mutáveis na aplicação Express, permitindo isolamento individual por requisição.

---

### 5. Como ocorre o rollback após falhas

Se uma asserção do Jest falhar durante o teste (`expect(res.statusCode).toBe(201)` recebendo outro código):
1. O Jest lança um `JestAssertionError`.
2. O helper `executarComRollback` intercepta o erro e o relança dentro do callback do `$transaction`.
3. O Prisma detecta a exceção e dispara o `ROLLBACK` no MySQL.
4. O helper captura a exceção no bloco externo, verifica que a tabela voltou ao estado original (`expect(depoisFalha).toEqual(antes)`) e relança o erro original da asserção com seu rastreamento intacto para o Jest registrar a falha do teste.

---

### 6. Como testar a restauração de registros pré-existentes

Os testes em `produtoRollback.test.js` e `usuarioRollback.test.js` cobrem dois tipos de validação:

1. **Fixtures criadas dentro da transação:** Criação, leitura, atualização e exclusão de itens dentro do escopo transacional, comprovando que após o rollback esses registros deixam de existir no banco.
2. **Registros pré-existentes no banco de testes:**
   - **Cenário de `PUT`:** Consulta o primeiro registro pré-existente no banco de testes, altera seu valor via API dentro da transação, confirma a alteração em `tx`, executa rollback e confirma que os valores originais foram restaurados com exatidão (`toEqual(dadosOriginais)`).
   - **Cenário de `DELETE`:** Consulta o primeiro registro pré-existente, exclui-o via API dentro da transação, confirma que ele retornou `null` em `tx`, executa rollback e confirma que o registro continua existindo no banco com todos os seus atributos originais.

> **Aviso sobre bases vazias:** Se a tabela estiver vazia no momento da execução (por exemplo, após rodar `npm run test:clean`), os testes de registros pré-existentes sinalizam explicitamente via console: `[AVISO] CENÁRIO NÃO VALIDADO: Nenhum produto preexistente encontrado...`. Para validar esses cenários, consulte a seção 9 abaixo sobre preparação de dados.

---

### 7. Por que o `AUTO_INCREMENT` pode continuar avançando após o rollback

No motor de armazenamento MySQL InnoDB, a sequência de `AUTO_INCREMENT` é gerenciada em memória por um mecanismo de alocação de IDs desacoplado do *undo log* das transações. Isso é feito deliberadamente pelo MySQL para evitar gargalos e bloqueios concorrentes em sistemas de alta vazão.

Consequentemente:
- Se uma transação insere um registro recebendo o ID `10` e a transação é revertida por `ROLLBACK`, o ID `10` **não é reutilizado**.
- A próxima inserção receberá o ID `11`.
- O rollback transacional garante a restauração e integridade das **linhas, colunas e dados relacionais da tabela**, mas **não reverte contadores internos de sequência do banco de dados**.

---

### 8. Como executar separadamente cada grupo de testes

| Comando | Descrição | Segurança dos Dados |
| :--- | :--- | :--- |
| `npm run test:unit` | Executa testes unitários de regras de validação. | **Seguro:** não acessa o banco de dados. |
| `npm run test:rollback` | Executa testes de integração com rollback transacional em Produto e Usuário. | **Seguro:** reverte todas as mutações via transação. |
| `npm test` | Execução padrão recomendada (unitários + rollback). | **Seguro:** valida a aplicação sem apagar dados prévios. |
| `npm run test:clean` | Executa testes legados com `deleteMany()`. | ⚠️ **Destrutivo:** apaga dados das tabelas de teste. |
| `npm run test:all` | Executa todas as suítes existentes sequencialmente. | ⚠️ **Destrutivo:** inclui as suítes legadas de limpeza. |

---

### 9. Como preparar dados e verificar evidências

Para verificar a restauração de dados pré-existentes com evidências concretas:

1. **Inserir dados prévios no banco de testes (`loja_teste`):**
   ```bash
   node -e 'require("dotenv").config(); const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } }); Promise.all([p.produto.create({ data: { nome: "Monitor 4K Preexistente", preco: 2500, quantidade: 3 } }), p.usuario.create({ data: { nome: "User Preexistente", telefone: "11988887777", email: "pre@teste.com", senha: "senhaValida123" } })]).then(() => console.log("Dados inseridos com sucesso!")).finally(() => p.$disconnect());'
   ```

2. **Executar a suíte de rollback:**
   ```bash
   npm run test:rollback
   ```

3. **Inspecionar a persistência pós-teste:**
   ```bash
   node -e 'require("dotenv").config(); const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } }); Promise.all([p.produto.findMany(), p.usuario.findMany()]).then(([prods, users]) => console.log({ produtos: prods.length, usuarios: users.length })).finally(() => p.$disconnect());'
   ```
   Os registros inseridos no passo 1 permanecem presentes e com os mesmos valores, comprovando o rollback integral das operações de `POST`, `PUT` e `DELETE`.
