# API

Route Handlers em `src/app/api`, todos com o wrapper `route()` (`src/server/http.ts`): sessão, papel, `Origin` do próprio site em mutações, corpo ≤ 32 KB, validação Zod e erros no formato:

```json
{
  "error": {
    "code": "conflict",
    "message": "Outro analista já assumiu esta conversa.",
    "requestId": "…"
  }
}
```

| Código            | HTTP | Uso                                                |
| ----------------- | ---- | -------------------------------------------------- |
| `validation`      | 400  | Entrada inválida                                   |
| `unauthenticated` | 401  | Sem sessão ou sessão expirada                      |
| `forbidden`       | 403  | Papel errado ou origem não permitida               |
| `not_found`       | 404  | Inexistente **ou** de outro funcionário            |
| `conflict`        | 409  | Estado mudou, versão desatualizada, ação já feita  |
| `rate_limited`    | 429  | Limite de uso (`details.retryAfterSeconds`)        |
| `limit_reached`   | 429  | Limite de 30 mensagens da sessão                   |
| `unavailable`     | 503  | Sistema de chamados ou provedor de IA indisponível |

## Autenticação

| Método e rota           | Quem    | Descrição                                  |
| ----------------------- | ------- | ------------------------------------------ |
| `POST /api/auth/login`  | público | `{ email, password, rememberMe }` → cookie |
| `POST /api/auth/logout` | público | Revoga a sessão e apaga o cookie           |
| `GET /api/me`           | logado  | Identidade da sessão                       |
| `GET /api/health`       | público | Banco e configuração do modelo             |

## Conversa do funcionário

| Método e rota                         | Descrição                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat`                      | `{ conversationId \| null, clientId, text, retryOfMessageId? }`. Com o agent: stream NDJSON (`accepted`, `action`, `text`, `done` \| `error`). Com analista: JSON `{ mode: "human", message }` |
| `GET /api/conversations`              | Funcionário: histórico das próprias conversas. Analista: fila (`filter`, `q`) + contadores                                                                                                     |
| `POST /api/conversations`             | Nova conversa (encerra a atual se estiver com o agent)                                                                                                                                         |
| `GET /api/conversations/:id/messages` | Página mais recente; `before=<seq>` (anteriores); `after=<seq>` (novas). `limit` ≤ 100                                                                                                         |
| `POST /api/conversations/:id/handoff` | Funcionário pede analista sem passar pelo modelo                                                                                                                                               |
| `GET /api/turns/:id`                  | Decisão e ações do turno (analista também vê entradas, saídas e tokens)                                                                                                                        |
| `GET /api/knowledge/:id`              | Artigo publicado                                                                                                                                                                               |

## Rascunhos

| Método e rota                  | Descrição                                                             |
| ------------------------------ | --------------------------------------------------------------------- |
| `PATCH /api/drafts/:id`        | Edição pelo funcionário com `expectedVersion`; prioridade recalculada |
| `POST /api/drafts/:id/confirm` | Confirma (idempotente); cria, atualiza ou reabre o chamado            |
| `POST /api/drafts/:id/cancel`  | Cancela                                                               |

## Chamados

| Método e rota                | Quem     | Descrição                                             |
| ---------------------------- | -------- | ----------------------------------------------------- |
| `GET /api/tickets`           | logado   | Funcionário: os próprios. Analista: `?employeeId=`    |
| `GET /api/tickets/:number`   | logado   | Detalhe + histórico (404 se não for do funcionário)   |
| `PATCH /api/tickets/:number` | analista | `{ expectedVersion, status?, note? }`; renova o prazo |

## Console do analista

| Método e rota                        | Descrição                                               |
| ------------------------------------ | ------------------------------------------------------- |
| `GET /api/conversations/:id`         | Estado, resumo da última transferência, chamado em foco |
| `POST /api/conversations/:id/claim`  | Assumir (atômico)                                       |
| `POST /api/conversations/:id/reply`  | `{ clientId, text }`; só o analista que assumiu         |
| `POST /api/conversations/:id/return` | Devolver ao agent                                       |
| `POST /api/conversations/:id/close`  | Encerrar                                                |
| `POST /api/conversations/:id/read`   | Marca como lida                                         |
| `GET/PUT /api/analysts/presence`     | Disponibilidade e heartbeat                             |
