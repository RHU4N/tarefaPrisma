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

Para executar os testes com isolamento:

```bash
# Testes unitários de validação
npm run test:unit

# Testes de integração com rollback transacional seguro (preserva dados do banco)
npm run test:rollback

# Testes de integração legados com limpeza destrutiva (deleteMany)
npm run test:clean

# Execução segura padrão (unitários + rollback, sem apagar registros existentes)
npm test
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

Esta seção documenta a implementação de testes de integração com rollback transacional real utilizando o Prisma ORM e o Supertest, localizados em `src/tests/produtoRollback.test.js` (Produtos) e `src/tests/usuarioRollback.test.js` (Usuários).

### 1. Como funciona o `deleteMany()`
Na abordagem com limpeza manual (como vista em `src/tests/produto.test.js` e `src/tests/usuario.test.js`), um hook `beforeEach()` ou `afterEach()` executa comandos DML de exclusão (`DELETE FROM Produto` / `DELETE FROM Usuario`) diretamente no banco de dados para esvaziar a tabela antes ou após cada teste.

### 2. Por que `deleteMany()` não é rollback
- **Exclusão destrutiva:** Em vez de restaurar o banco ao estado original, o `deleteMany()` elimina fisicamente todos os registros da tabela. Se o banco possuía dados pré-existentes (de homologação, desenvolvimento ou sementes de teste), esses dados são permanentemente apagados.
- **Não reversão de alterações:** Se um teste executa `UPDATE` ou `DELETE` em um registro existente, o `deleteMany()` não desfaz a alteração para voltar ao valor anterior; ele simplesmente apaga a tabela por completo.
- **Risco de efeitos colaterais:** Não oferece isolamento atômico caso o processo seja interrompido abruptamente, deixando o banco vazio.

### 3. Como funciona o `$transaction()`
O Prisma oferece transações interativas através do método `$transaction(async (tx) => { ... })`:
- Ao ser invocado, o Prisma inicia uma transação real no banco de dados (`START TRANSACTION`).
- Um cliente transacional (`tx`) exclusivo é fornecido para o callback. Qualquer consulta ou mutação executada através de `tx` participa estritamente daquela transação.
- **Decisão de Commit ou Rollback:** Se o callback for concluído normalmente, o Prisma envia `COMMIT`. Caso uma exceção seja disparada (rejeição da Promise), o Prisma envia `ROLLBACK` ao banco MySQL.

### 4. Como o rollback restaura os registros anteriores
O mecanismo de armazenamento do MySQL (InnoDB) utiliza logs de reversão (*undo logs*). Ao receber o comando `ROLLBACK`:
- Quaisquer `INSERT` efetuados na transação são descartados.
- Quaisquer `UPDATE` têm seus valores anteriores restaurados a partir dos logs de undo.
- Quaisquer `DELETE` têm suas linhas recuperadas integralmente.

> **Importante sobre escopo e `AUTO_INCREMENT`:** O rollback transacional garante estritamente a preservação do **conteúdo dos registros e seus dados relacionais**. Ele **não** restaura o contador interno de `AUTO_INCREMENT` no MySQL InnoDB, pois a alocação de IDs sequenciais é gerida fora da transação para evitar gargalos de concorrência. Portanto, IDs consumidos durante inserções revertidas não são reciclados pelo banco de dados.

Para garantir o rollback ao término de cada teste com sucesso, utiliza-se a estratégia de **rollback intencional**:
- As fixtures necessárias para o teste são criadas **dentro** da própria transação (`tx`).
- O teste executa as requisições HTTP reais com Supertest e as asserções do Jest.
- No final do callback da transação, lança-se propositalmente um erro especial (`RollbackIntencionalError`).
- O Prisma intercepta o erro e executa o `ROLLBACK` no MySQL.
- O helper de teste trata o erro intencional como sucesso e relança apenas erros legítimos de falha de teste (ex.: asserções do Jest).
- Em caso de falha de asserção, o erro é relançado forçando o `ROLLBACK` no banco e sendo reportado pelo Jest.

### 5. Integração com Supertest e Injeção de Dependência por Requisição
Para que requisições disparadas pelo Supertest participem da transação ativa sem conflito de concorrência ou estado global:
- Em `src/config/prisma.js`, é mantido um registro de transações ativas mapeado por ID (`transacoesAtivas = new Map()`).
- No `server.js`, um middleware inspeciona o cabeçalho HTTP `x-transaction-id`:
  ```javascript
  app.use((req, res, next) => {
    const txId = req.headers["x-transaction-id"];
    const tx = obterTransacao(txId);
    req.prisma = tx || req.app?.get("prisma") || prisma;
    next();
  });
  ```
- Nos controllers (`ProdutoController.js` e `UsuarioController.js`), as funções de rota obtêm o Prisma via `req.prisma || req.app?.get("prisma") || defaultPrisma`.
- Durante cada teste, é gerado um UUID único (`transacaoId`). O cliente HTTP de teste injeta automaticamente `x-transaction-id: transacaoId`.
- Isso garante **isolamento total por requisição**, prevenindo race conditions entre testes concorrentes e preservando o comportamento original da API.

### 6. Como comprovar o rollback com evidências
Em `produtoRollback.test.js` e `usuarioRollback.test.js`, a preservação dos dados é comprovada com as seguintes evidências automatizadas:
1. **Snapshot pré e pós-teste:** Captura-se `findMany({ orderBy: { id: "asc" } })` antes da transação e compara-se após o rollback (`expect(depois).toEqual(antes)`).
2. **Evidência de POST:** O registro é consultado dentro de `tx` confirmando sua criação, e consultado fora da transação após o rollback confirmando que `findUnique` retorna `null`.
3. **Evidência de PUT:** O registro é alterado temporariamente via HTTP dentro de `tx`, e após o rollback confirma-se que seus valores foram restaurados aos originais.
4. **Evidência de DELETE:** O registro é excluído via HTTP dentro de `tx`, e após o rollback confirma-se que ele continua existindo no banco.
5. **Evidência em caso de falha:** Um teste de falha deliberada confirma que mesmo quando uma asserção falha, o rollback ocorre e os dados permanecem intactos.

### 7. Limpeza vs. Rollback Transacional

| Critério | Limpeza (`deleteMany`) | Rollback Transacional (`$transaction`) |
| :--- | :--- | :--- |
| **Preservação de dados pré-existentes** | ❌ Não preserva (apaga permanentemente) |  Preserva 100% dos registros anteriores |
| **Mecanismo utilizado** | Comandos DML `DELETE` explícitos fora de tx | Mecanismo nativo de transação ACID (`ROLLBACK`) |
| **Comportamento em Updates/Deletes** | Destrói os dados em vez de restaurar | Restaura valores alterados e linhas excluídas |
| **Impacto no `AUTO_INCREMENT`** | Consome novos IDs a cada exclusão em massa | IDs consumidos em inserts revertidos não são reciclados |
| **Garantia de integridade** | Nenhuma (dados apagados se o teste falhar) | Atômica (reverte até mesmo em caso de erro) |
| **Velocidade e I/O** | Lento (múltiplas gravações e exclusões em disco) | Rápido (reversão em memória/undo log) |
| **Segurança para dados prévios** | ⚠️ Alto risco de perda de dados | 🛡️ Seguro, isolado e atômico |

### 8. Scripts e Comandos de Execução

No `package.json`, os comandos foram separados para garantir execuções seguras e não destrutivas:

```bash
# Executa apenas testes unitários de validação (sem acesso ao banco)
npm run test:unit

# Executa apenas testes de integração com rollback transacional (seguro)
npm run test:rollback

# Executa testes legados com limpeza destrutiva (atenção: apaga dados de Produto e Usuario)
npm run test:clean

# Execução segura padrão (unitários + rollback, sem apagar registros prévios)
npm test

# Executa todas as suítes em sequência
npm run test:all
```
