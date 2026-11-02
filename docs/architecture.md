# Arquitetura

## Visão geral

Um único app Next.js (App Router) com runtime Node. A interface, a API, o agent e o serviço de chamados vivem no mesmo deploy, mas em módulos com dependências numa só direção:

```
src/app, src/components   (interface: páginas e componentes React)
        │
src/app/api, src/server/http.ts   (borda HTTP: sessão, autorização, validação, erros)
        │
src/server/agent          (Mastra: agent, ferramentas, turno)
src/server/conversations  (casos de uso: estado, transferência, fila)
src/server/tickets        (serviço de chamados + gateway resiliente + rascunhos)
src/server/knowledge      (busca na central de ajuda)
        │
src/domain                (regras puras: prioridade, SLA, duplicidade, estados)
        │
src/server/db             (schema Drizzle, cliente, seed) → PostgreSQL
```

Regras que valem para o código todo:

- Componentes não acessam banco nem contêm regra de negócio; falam com a API.
- O agent só altera dados por ferramentas que chamam casos de uso; nunca SQL livre.
- O domínio não conhece banco, HTTP nem Mastra, e é testado isoladamente.
- Mutações que mexem em mais de uma tabela rodam numa transação.

## Pastas

| Pasta                      | Conteúdo                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `src/app/(employee)`       | `/atendimento` (chat) e `/perfil`, protegidos para funcionários            |
| `src/app/(analyst)`        | `/console`, protegido para analistas                                       |
| `src/app/entrar`           | Login                                                                      |
| `src/app/api`              | Route Handlers (lista em [api.md](api.md))                                 |
| `src/components/chat`      | Lista de mensagens, blocos (cartões, rascunho, opções), trilha de ações    |
| `src/components/console`   | Fila, conversa e painel de chamados do console                             |
| `src/domain`               | `tickets.ts`, `priority.ts`, `sla.ts`, `similarity.ts`, `conversations.ts` |
| `src/server/agent`         | `agent.ts`, `tools.ts`, `instructions.ts`, `turn.ts`, `context-builder.ts` |
| `src/server/conversations` | Repositório, máquina de estados, transferência, fila, serialização         |
| `src/server/tickets`       | `service.ts`, `gateway.ts`, `drafts.ts`, DTOs                              |
| `src/server/db`            | `schema.ts`, `client.ts`, `seed.ts`                                        |
| `drizzle/`                 | Migrações SQL versionadas                                                  |
| `tests/`                   | `unit`, `integration`, `e2e`, `eval`                                       |

## Modelo de dados

| Tabela               | Para quê                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `users`              | Funcionários e analistas (papel, área, nível de suporte, sistema operacional)                         |
| `sessions`           | Sessões (hash do token, expiração, revogação)                                                         |
| `tickets`            | Chamados: número público, solicitante, tipo, categoria, prioridade, escopo, status, SLA, versão       |
| `ticket_events`      | Histórico de cada chamado (quem, o quê, de/para, nota)                                                |
| `ticket_drafts`      | Rascunhos de criação, atualização e reabertura; fatos de impacto/urgência; status de confirmação      |
| `conversations`      | Dono, estado (agent/aguardando/analista/encerrada), analista, contador da sessão, chamado em foco     |
| `messages`           | Mensagens com `seq` monotônico, tipo (funcionário/agent/analista/sistema), blocos JSON, id do cliente |
| `handoffs`           | Transferências: origem, motivo, resumo, nível, prazo de resposta, quem assumiu                        |
| `agent_turns`        | Cada turno do agent: modelo, status, latência, tokens, erro                                           |
| `agent_actions`      | Cada execução de ferramenta: entrada, saída, resumo, duração, status                                  |
| `agent_decisions`    | Decisão do turno: intenção, entendimento, ação, segurança, motivo, regras                             |
| `knowledge_articles` | Artigos da central (texto normalizado + índice GIN full-text em português)                            |
| `analyst_presence`   | Disponibilidade, heartbeat e saída (`left_at`) dos analistas: "Online" / "Offline há 5 min"           |
| `audit_events`       | Auditoria de login, confirmações, transferências e ações do analista                                  |
| `rate_limits`        | Contadores por janela, compartilhados entre instâncias                                                |

Índices relevantes: `(employee_id, last_activity_at)` e `(state, last_activity_at)` em conversas; `(conversation_id, seq)` em mensagens; `(requester_id, status)` em chamados; únicos parciais garantem **uma conversa viva por funcionário** e **um turno em andamento por conversa**.

## Concorrência

- Estados de conversa e chamados mudam com update condicional em `version` (otimista). Quem perde recebe 409 com mensagem clara.
- Assumir, devolver, encerrar e confirmar rascunho travam a linha (`select ... for update`) dentro de uma transação.
- Números de chamado vêm de sequências do Postgres (`inc_number_seq`, `req_number_seq`).
- Mensagens são idempotentes por `(conversation_id, client_id)`.

## Integração com um sistema de chamados real

O agent e as rotas falam com `callTicketService(operation, fn)` (`src/server/tickets/gateway.ts`), que hoje executa `TicketService` sobre o Postgres dentro de uma transação, com timeout, até 3 tentativas para falhas transitórias e um circuit breaker.

Para ligar a um service desk corporativo (ServiceNow, Jira SM, GLPI...):

1. Implementar um adaptador com as mesmas operações de `TicketService` (`listForRequester`, `findForRequester`, `findByNumber`, `create`, `addEmployeeNote`, `reopen`, `transfer`, `analystUpdate`, `events`).
2. Mapear: número público ↔ id externo; categorias/prioridades do PRD ↔ taxonomia do sistema; solicitante pelo e-mail corporativo; prazo (`slaDueAt`) calculado aqui ou lido do sistema externo; histórico ↔ journal/comentários.
3. Manter a confirmação idempotente: gravar o id externo no rascunho antes de responder ao funcionário, ou usar uma tabela outbox para criar fora da transação e reconciliar.
4. Trocar `callTicketService` para usar o adaptador; o agent e a interface não mudam.

## Tempo real

- Resposta do agent: streaming NDJSON da própria requisição (`POST /api/chat`) com os tokens reais do modelo. O cliente mostra os pontinhos assim que a mensagem sai, a trilha de ferramentas enquanto elas rodam e revela o texto num ritmo de leitura (acelera quando o modelo está à frente); a mensagem gravada só substitui a bolha quando a revelação termina.
- Demais atualizações: polling incremental por cursor (`?after=<seq>`), 2 s com uma pessoa do outro lado e 3–3,5 s com o agent, 5 s na fila, pausado com a aba oculta e retomado ao voltar a aba ou a rede. Cada resposta traz o estado autorizado da conversa (dono, analista, digitação, presença, turno em andamento), então reconexão é só pedir de novo a partir do último `seq`. No console, cada mensagem ou mudança de estado recarrega na hora o painel de chamados e o resumo da conversa.
- Presença: o chat do funcionário marca `employee_seen_at` a cada poll visível; o console envia heartbeat a cada 15 s e `leaving` ao fechar a aba (e o logout grava `left_at`). Online = heartbeat com menos de 45 s e posterior à última saída.
- Nenhum estado em memória é compartilhado entre instâncias: tudo vem do Postgres.

## Observabilidade

- Logs JSON por requisição com `requestId` (também no cabeçalho `x-request-id`), método, rota, status e duração.
- Turnos do agent: `turnId`, latência total e do primeiro token, tokens de entrada/saída, se houve transferência ou descarte.
- Falhas de ferramentas e do serviço de chamados com operação e tentativa.
- `GET /api/health`: banco e presença de configuração do modelo (sem valores).
- Retenção: `agent_*`, `ticket_events`, `audit_events` são dados de produto (sem expiração); `rate_limits` guarda só a janela atual de cada chave (a primeira contagem de uma janela apaga as anteriores).
