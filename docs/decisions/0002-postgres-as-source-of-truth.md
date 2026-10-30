# 0002 · Postgres (Neon) como fonte da verdade

**Contexto.** Analista e funcionário estão em dispositivos diferentes; funções serverless não guardam estado; conversas e chamados precisam sobreviver a reinício e deploy; criar chamado exige transação.

**Decisão.** PostgreSQL com Drizzle e migrações versionadas, Neon em produção. `localStorage` só guarda o texto não enviado do compositor.

**Consequências.** Transações, índices únicos e updates condicionais resolvem concorrência (claim, confirmação, numeração). Limites de uso também ficam no Postgres, sem Redis. Exige um passo de migração por release.
