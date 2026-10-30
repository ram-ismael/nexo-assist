# 0005 · Polling incremental entre funcionário e analista

**Contexto.** Funções serverless não mantêm conexões nem compartilham memória; um provedor de tempo real seria mais uma conta e mais uma credencial.

**Decisão.** A resposta do agent é transmitida por streaming na própria requisição. Mensagens entre pessoas e mudanças de estado chegam por polling por cursor (`after=<seq>`), a cada 3–5 s, só com a aba visível.

**Consequências.** Simples e correto sob reconexão (o cursor deduplica). Até alguns segundos de atraso e consultas leves e indexadas. Trocar por push mantém o mesmo cursor.
