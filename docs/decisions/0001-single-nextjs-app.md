# 0001 · Um único app Next.js

**Contexto.** O PRD sugere Next.js e pede separação entre interface, agent e serviço de chamados. O deploy alvo é a Vercel.

**Decisão.** Um projeto Next.js com Route Handlers em runtime Node. A separação é por módulos (`src/domain`, `src/server/tickets`, `src/server/agent`, `src/server/conversations`, `src/components`) com dependências numa só direção, não por serviços.

**Consequências.** Um deploy, sem rede entre agent e serviço de chamados, tipos compartilhados. O serviço de chamados continua isolado atrás de `callTicketService`, então pode virar outro processo ou um sistema externo sem mexer no agent.
