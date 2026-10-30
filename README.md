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

Os testes ficam em `src/tests/validarUsuario.test.js` e verificam dados
válidos, campos obrigatórios, senha curta, e-mail inválido, telefones de 10 e
11 dígitos, telefone inválido e campo com tipo incorreto.

Execute:

```bash
npm.cmd test -- --runInBand
```

## Roteiro manual — Insomnia ou Thunder Client

1. Inicie a API com `npm.cmd run dev`.
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
Na abordagem tradicional com `deleteMany()` (como vista em `src/tests/produto.test.js` e `src/tests/usuario.test.js`), um hook `beforeEach()` ou `afterEach()` executa comandos `DELETE` diretamente no banco de dados antes ou após a execução de cada teste.

### 2. Por que `deleteMany()` não é rollback
- **Exclusão destrutiva:** Em vez de restaurar o banco ao estado original, o `deleteMany()` elimina fisicamente todos os registros da tabela. Se o banco possuía dados pré-existentes (de homologação, desenvolvimento ou sementes de teste), esses dados são permanentemente apagados.
- **Não reversão de alterações:** Se um teste apenas faz `UPDATE` em um registro existente, o `deleteMany()` não desfaz a alteração para voltar ao valor anterior; ele simplesmente deleta o registro por completo.
- **Efeitos colaterais no banco:** Incrementa desnecessariamente os contadores de `AUTO_INCREMENT` e gera operações de escrita e remoção em disco que tornam as suítes lentas.

### 3. Como funciona o `$transaction()`
O Prisma oferece transações interativas através do método `$transaction(async (tx) => { ... })`:
- Ao ser invocado, o Prisma inicia uma transação real no banco de dados (`START TRANSACTION`).
- Um cliente transacional (`tx`) exclusivo é fornecido para o callback. Qualquer consulta ou mutação executada através de `tx` participa daquela transação.
- **Decisão de Commit ou Rollback:** Se o callback for concluído com sucesso, o Prisma envia `COMMIT`. Caso uma exceção seja disparada (rejeição da Promise), o Prisma envia `ROLLBACK` ao banco.

### 4. Como o rollback restaura os registros anteriores
O mecanismo de transação do MySQL/InnoDB utiliza logs de reversão (*undo logs*). Ao receber o comando `ROLLBACK`:
- Quaisquer `INSERT` efetuados na transação são descartados.
- Quaisquer `UPDATE` têm seus valores anteriores restaurados a partir dos logs de undo.
- Quaisquer `DELETE` têm suas linhas recuperadas integralmente.
- O banco volta exatamente ao estado em que se encontrava no momento do `START TRANSACTION`, preservando dados pré-existentes.

Para garantir o rollback ao término de cada teste com sucesso, utiliza-se a estratégia de **rollback intencional**:
- O teste executa as requisições HTTP reais com Supertest e as asserções do Jest.
- No final do callback da transação, lança-se propositalmente um erro especial (`RollbackIntencionalError`).
- O Prisma intercepta o erro e executa o `ROLLBACK` no MySQL.
- O helper de teste trata o erro intencional como sucesso e relança apenas erros legítimos de falha de teste (ex.: asserções do Jest).

### 5. Integração com Supertest e Injeção de Dependência
Para que as requisições do Supertest participem da transação do Prisma, a aplicação precisa usar o cliente transacional (`tx`) em vez da instância global do Prisma. Foi aplicada uma injeção de dependência mínima:
- No `server.js`, a instância do Prisma é associada à aplicação (`app.set("prisma", prisma)`) e disponibilizada via middleware (`req.prisma`).
- Nos controllers (`ProdutoController.js` e `UsuarioController.js`), as funções de rota obtêm o Prisma via `req.prisma || req.app?.get("prisma") || defaultPrisma`.
- Durante o teste, o helper define temporariamente `app.set("prisma", tx)`. Assim, todas as rotas acionadas via `request(app)` utilizam o cliente transacional ativo.

### 6. Como verificar a preservação dos dados
Em `produtoRollback.test.js` e `usuarioRollback.test.js`, a preservação dos dados é garantida automaticamente:
1. Um snapshot dos registros da tabela (`Produto` ou `Usuario`) é capturado antes de iniciar a transação (`findMany`).
2. A transação e as operações do Supertest (GET, POST, PUT, DELETE) são executadas.
3. O rollback é disparado.
4. Um novo snapshot da tabela é comparado com o inicial:
   ```javascript
   const registrosDepois = await prisma.entidade.findMany({ orderBy: { id: "asc" } });
   expect(registrosDepois).toEqual(registrosAntes);
   ```
5. Além disso, testes específicos confirmam que:
   - Registros inseridos deixam de existir fora da transação após o rollback (`findUnique` retorna `null`).
   - Registros atualizados têm seus valores originais restaurados no banco após o rollback.
   - Registros excluídos continuam existindo no banco após o rollback.
   - O rollback ocorre mesmo se o teste falhar em uma asserção.

### 7. Limpeza vs. Rollback Transacional

| Critério | Limpeza (`deleteMany`) | Rollback Transacional (`$transaction`) |
| :--- | :--- | :--- |
| **Preservação de dados pré-existentes** | ❌ Não preserva (apaga tudo) |  Preserva 100% dos registros anteriores |
| **Mecanismo utilizado** | Comandos DML `DELETE` explícitos | Mecanismo nativo de transação ACID (`ROLLBACK`) |
| **Comportamento em Updates/Deletes** | Destrói a linha em vez de restaurar | Restaura valores alterados ou linhas deletadas |
| **Impacto no `AUTO_INCREMENT`** | Consome novos IDs a cada ciclo | IDs temporários não persistem no banco |
| **Velocidade e I/O** | Lento (múltiplas gravações e exclusões em disco) | Rápido (reversão em memória/undo log) |
| **Segurança para dados prévios** | ⚠️ Alto risco de perda de dados | 🛡️ Seguro, isolado e atômico |

### 8. Como executar os testes

Executar as suítes com rollback:
```bash
npx jest src/tests/produtoRollback.test.js
npx jest src/tests/usuarioRollback.test.js
```

Executar todos os testes em ordem sequencial:
```bash
npm test -- --runInBand
```
