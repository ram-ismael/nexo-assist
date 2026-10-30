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
| Agent só lista os chamados do funcionário                         | `tests/integration/agent.test.ts`                       |
| Prazo vencido calculado de timestamps                             | `agent.test.ts`                                         |
| Agent para durante atendimento humano                             | `agent.test.ts`                                         |
| Ferramenta negada se o analista assumir no meio                   | `agent.test.ts`                                         |
| Limite de 30 mensagens no servidor                                | `agent.test.ts`                                         |
| Provedor fora do ar sem resposta inventada                        | `agent.test.ts`                                         |
| Jornada consulta → vencido → transferência → analista → devolução | `e2e/journey.spec.ts`                                   |
| Chamado só depois de confirmar                                    | `e2e/journey.spec.ts`                                   |
| CSRF, sessão, logout, perfil                                      | `e2e/auth.spec.ts`                                      |
| Celular sem rolagem horizontal                                    | `e2e/mobile.spec.ts`                                    |
| Decisões do agent nos cenários do PRD                             | `tests/eval/agent-eval.test.ts`                         |

## Resultados

Execução local de 30/10/2026 (Node 26, PostgreSQL 18):

- `pnpm test`: 38 unitários + 27 de integração, todos passando.
- `pnpm test:e2e`: 11 passando com `next dev`; o job `e2e` do CI roda com `next start`.
- `pnpm eval:agent`: **não executado**, por falta da chave da Anthropic neste ambiente (os 15 cenários aparecem como _skipped_).

No CI (GitHub Actions) os jobs `verify` e `e2e` rodam em cada PR.

## Modelo determinístico

O CI não chama o modelo pago. `NEXO_SCRIPTED_MODEL=true` liga um `LanguageModelV4` de roteiros fixos (`src/server/agent/scripted-model.ts`) que passa pelo Mastra, pelas ferramentas e pelo banco de verdade. Ele valida a infraestrutura do agent, não a qualidade das decisões; para isso existe `pnpm eval:agent`.
