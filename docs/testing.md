# Testes

| Comando                 | O que roda                                                 | Banco               |
| ----------------------- | ---------------------------------------------------------- | ------------------- |
| `pnpm test:unit`        | Regras de domínio, componentes e formatação                | nenhum              |
| `pnpm test:integration` | Serviços, casos de uso e o agent com modelo determinístico | `DATABASE_URL_TEST` |
| `pnpm test:e2e`         | Playwright no app real (desktop e celular)                 | `DATABASE_URL_E2E`  |
| `pnpm eval:agent`       | 15 cenários do PRD com o modelo real                       | `DATABASE_URL_TEST` |
| `pnpm verify`           | formatação + lint + tipos + unit + integração + build      |                     |

Os bancos de teste são recriados a cada execução (truncate + seed). Sem `DATABASE_URL_TEST`, o padrão é `postgresql:///nexo_assist_test` via socket local.

## Cobertura por requisito

| Requisito                                                         | Onde                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| Limites do SLA, feriados, crítico 24h                             | `tests/unit/sla.test.ts`                                |
| Prioridade, reabertura, transições, duplicidade                   | `tests/unit/domain-rules.test.ts`                       |
| Isolamento entre funcionários                                     | `tests/integration/tickets.test.ts`, `e2e/auth.spec.ts` |
| Números de chamado sob concorrência                               | `tickets.test.ts`                                       |
| Retry e indisponibilidade do sistema de chamados                  | `tickets.test.ts`                                       |
| Confirmação idempotente (cliques simultâneos)                     | `conversations.test.ts`                                 |
| Crítico confirmado → analista                                     | `conversations.test.ts`                                 |
| Dois analistas assumindo ao mesmo tempo                           | `conversations.test.ts`                                 |
| Encerrar não muda chamados                                        | `conversations.test.ts`                                 |
| Histórico com 120 mensagens, cursores sem lacuna                  | `conversations.test.ts`                                 |
| `seq` na ordem de commit (polling nunca pula mensagem)            | `conversations.test.ts`                                 |
| Contagens da fila: vivas + encerradas há até 7 dias               | `conversations.test.ts`                                 |
| Turno abandonado (função morta) não trava a conversa              | `agent.test.ts`                                         |
| Status do assistente a partir dos turnos recentes                 | `tests/unit/assistant.test.ts`                          |
| Agent só lista os chamados do funcionário                         | `tests/integration/agent.test.ts`                       |
| Prazo vencido calculado de timestamps                             | `agent.test.ts`                                         |
| Agent para durante atendimento humano                             | `agent.test.ts`                                         |
| Ferramenta negada se o analista assumir no meio                   | `agent.test.ts`                                         |
| Limite de 30 mensagens no servidor                                | `agent.test.ts`                                         |
| Provedor fora do ar sem resposta inventada                        | `agent.test.ts`                                         |
| Jornada consulta → vencido → transferência → analista → devolução | `e2e/journey.spec.ts`                                   |
| Chamado só depois de confirmar                                    | `e2e/journey.spec.ts`                                   |
| CSRF, sessão, logout, perfil                                      | `e2e/auth.spec.ts`                                      |
| CSP com nonce sem violações; novo login revoga a sessão anterior  | `e2e/auth.spec.ts`                                      |
| Celular sem rolagem horizontal                                    | `e2e/mobile.spec.ts`                                    |
| Decisões do agent nos cenários do PRD                             | `tests/eval/agent-eval.test.ts`                         |

## Resultados

Execução local de 30/10/2026 (Node 26, PostgreSQL 18):

- `pnpm test`: 43 unitários + 31 de integração, todos passando.
- `pnpm test:e2e`: 13 passando contra o build de produção (`CI=1`, `next start`, sem retentativas).
- `pnpm eval:agent`: **não executado**, por falta da chave da Anthropic neste ambiente (os 15 cenários aparecem como _skipped_).

No CI (GitHub Actions) os jobs `verify` e `e2e` rodam em cada PR.

## Desempenho da fila do analista

A fila é consultada a cada 5 s por analista. `scripts/bench/volume.sql` cria um volume sintético (2.000 funcionários, 150 mil conversas encerradas em dois anos, 400 vivas, 1,2 milhão de mensagens) num banco descartável e `scripts/bench/queue.ts` mede as consultas reais (mediana de 20 execuções):

```bash
createdb nexo_assist_bench
DATABASE_URL=postgresql:///nexo_assist_bench pnpm tsx scripts/migrate.ts
psql nexo_assist_bench -f scripts/bench/volume.sql
DATABASE_URL=postgresql:///nexo_assist_bench pnpm tsx scripts/bench/queue.ts
```

| Consulta                    | Antes   | Depois |
| --------------------------- | ------- | ------ |
| `queueCounts`               | 25,9 ms | 0,8 ms |
| `listQueue` (Todas)         | 29,0 ms | 6,6 ms |
| `listQueue` (Todas + busca) | 28,6 ms | 8,0 ms |

A diferença vem de trocar `state <> 'closed'` (que nenhum índice atende) por estados vivos + índice parcial em `closed_at` das encerradas.

## Modelo determinístico

O CI não chama o modelo pago. `NEXO_SCRIPTED_MODEL=true` liga um `LanguageModelV4` de roteiros fixos (`src/server/agent/scripted-model.ts`) que passa pelo Mastra, pelas ferramentas e pelo banco de verdade. Ele valida a infraestrutura do agent, não a qualidade das decisões; para isso existe `pnpm eval:agent`.
