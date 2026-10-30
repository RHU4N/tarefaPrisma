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
