# 0003 · Histórico próprio em vez da memória do Mastra

**Contexto.** O Mastra oferece memória com armazenamento próprio. O produto já precisa de um modelo de mensagens mais rico (blocos de UI, rascunhos, mensagens de analista e de sistema, decisões por turno).

**Decisão.** O Mastra orquestra o agent e as ferramentas; o contexto de cada turno é reconstruído das tabelas do produto (16 mensagens recentes + fatos do turno), isolado por conversa e funcionário.

**Consequências.** Uma única fonte da verdade e controle explícito do tamanho do contexto (custo). Conversas muito longas perdem detalhes antigos; o próximo passo seria um resumo incremental.
