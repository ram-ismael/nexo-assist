# Regras do service desk

Fonte: Anexo A do PRD. Implementação em `src/domain`.

## Tipos e categorias

- **INC (incidente)**: algo parou ou não funciona.
- **REQ (requisição)**: pedido de acesso, equipamento ou software.
- **Categorias**: Acesso, Rede e VPN, Hardware, Software, E-mail, Outros.

## Prioridade (`classifyPriority`)

Avaliada nesta ordem; a primeira regra que bate decide:

| Regra                             | Condição                                        | Prioridade |
| --------------------------------- | ----------------------------------------------- | ---------- |
| `critical-collective-outage`      | Equipe ou empresa afetada **e** trabalho parado | Crítica    |
| `high-same-day-commitment`        | Compromisso hoje em risco                       | Alta       |
| `high-person-blocked`             | Trabalho parado **e** sem alternativa           | Alta       |
| `low-non-urgent-request`          | Requisição sem urgência                         | Baixa      |
| `medium-impaired-with-workaround` | Demais casos (atrapalha, há alternativa)        | Média      |

## Prazos (`sla.ts`)

| Prioridade | Relógio        | Duração                                      |
| ---------- | -------------- | -------------------------------------------- |
| Crítica    | Corrido (24/7) | 60 min                                       |
| Alta       | Útil           | 240 min                                      |
| Média      | Útil           | 3 × (fim − início do expediente) = 1.800 min |
| Baixa      | Útil           | 5 × expediente = 3.000 min                   |

- Expediente: `BUSINESS_DAY_START`–`BUSINESS_DAY_END` (8–18), seg–sex, em `BUSINESS_TIMEZONE` (padrão `America/Sao_Paulo`, já que a Nexo opera no Brasil).
- Fora do expediente o relógio útil começa na próxima abertura; o que sobra no fim do dia passa para o próximo dia útil; fins de semana e `BUSINESS_HOLIDAYS` são pulados.
- O prazo vale para a primeira resposta e para cada atualização: `sla_started_at` é a criação ou a última atualização do service desk (analista ou reabertura). Complemento do funcionário não renova.
- Vencido = status aberto e agora > `sla_due_at`. Tudo calculado de timestamps gravados; a política aplicada fica salva em `sla_policy`.

## Status de chamado

`open` (Aberto) · `in_progress` (Em andamento) · `waiting_analyst` (Aguardando analista) · `approved` (Aprovado) · `resolved` (Resolvido) · `closed` (Fechado). Os quatro primeiros contam como abertos.

Transições do analista:

| De                  | Para                                                   |
| ------------------- | ------------------------------------------------------ |
| Aberto              | Em andamento, Aguardando analista, Aprovado, Resolvido |
| Em andamento        | Aguardando analista, Aprovado, Resolvido               |
| Aguardando analista | Em andamento, Aprovado, Resolvido                      |
| Aprovado            | Em andamento, Resolvido                                |
| Resolvido           | Fechado, Em andamento                                  |
| Fechado             | —                                                      |

Reabertura pelo funcionário: só de **Resolvido** e até 7 dias após `resolved_at`. Depois disso, ou se **Fechado**, abre-se um novo chamado.

## Duplicidade (`rankDuplicates`)

Palavras-chave normalizadas (sem acento, sem palavras vazias, radical curto) de título + descrição; pontuação = termos em comum ÷ menor conjunto, +0,15 se a categoria coincide. Candidatos a partir de 0,34 são mostrados ao agent; `montar_rascunho` recusa quando há chamado aberto com pontuação ≥ 0,5, salvo se o funcionário confirmou que é outro problema.

## Conversa

| Estado            | Quem responde  | Eventos possíveis                            |
| ----------------- | -------------- | -------------------------------------------- |
| `agent_active`    | Agent          | transferência, analista assume, encerrar     |
| `waiting_analyst` | Ninguém (fila) | analista assume, devolver ao agent, encerrar |
| `analyst_active`  | Analista       | devolver ao agent, encerrar                  |
| `closed`          | —              | —                                            |

- Uma conversa viva por funcionário; "Nova conversa" encerra a atual se estiver com o agent.
- Encerrar a conversa não altera chamados.
- Limite da sessão: 30 mensagens do funcionário respondidas pelo agent (inclui respostas rápidas; não inclui mensagens trocadas com o analista nem turnos que falharam).

## Transferência

Motivos: pedido do funcionário, caso crítico, chamado vencido, baixa segurança do agent, fora das ferramentas, falha técnica. O registro guarda resumo, chamados envolvidos, nível (N2 para crítico ou vencido, N1 nos demais) e prazo de primeira resposta humana (1 h corrida para crítico; prazo do chamado se ainda não venceu; senão 4 horas úteis).
