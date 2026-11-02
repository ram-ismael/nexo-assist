# 0005 · Polling incremental entre funcionário e analista

**Contexto.** Funções serverless não mantêm conexões nem compartilham memória; um provedor de tempo real seria mais uma conta e mais uma credencial.

**Decisão.** A resposta do agent é transmitida por streaming na própria requisição. Mensagens entre pessoas e mudanças de estado chegam por polling por cursor (`after=<seq>`), a cada 3–5 s, só com a aba visível.

**Consequências.** Simples e correto sob reconexão (o cursor deduplica). Até ~2 s de atraso com uma pessoa do outro lado e consultas leves e indexadas. Trocar por push mantém o mesmo cursor.

**Revisto em 2026-11.** Avaliamos SSE e WebSocket. Na Vercel, uma conexão SSE é uma função aberta que precisaria consultar o banco do mesmo jeito (o pooler do Neon não entrega `LISTEN/NOTIFY`), cobrando duração de função por usuário conectado; WebSocket exige um serviço à parte. Mantivemos o polling por cursor e cobrimos com ele mensagens, digitação, turno do agent, presença, transferência, assumir/devolver/encerrar e chamados. Se a escala pedir push, o caminho é um provedor de pub/sub notificando "há novidade a partir do seq N" e o cliente buscando pelo mesmo endpoint.
