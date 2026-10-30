# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema numa conversa e o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados (sempre com confirmação) e chama um analista quando precisa. O analista recebe as conversas transferidas num console, assume o atendimento com o agent pausado e devolve ou encerra quando termina.

Tudo o que aparece depois do login é estado real: mensagens, chamados, transferências e decisões do agent ficam no Postgres. Os únicos dados de exemplo são os funcionários, analistas, artigos e chamados históricos do seed.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript estrito · Mastra · Anthropic Claude · PostgreSQL (Neon) · Drizzle · Tailwind 4 · Vitest · Playwright
- **Deploy:** um único projeto Vercel + Neon. Veja [Deploy](#deploy) para o estado atual.

## Sumário

1. [Como rodar](#como-rodar)
2. [Jornadas principais](#jornadas-principais)
3. [Arquitetura](#arquitetura)
4. [Como o agent decide](#como-o-agent-decide)
5. [Transparência das decisões](#transparência-das-decisões)
6. [Regras do service desk](#regras-do-service-desk)
7. [Persistência, tempo real e histórico](#persistência-tempo-real-e-histórico)
8. [Autenticação, autorização e segurança](#autenticação-autorização-e-segurança)
9. [Qualidade das decisões e testes](#qualidade-das-decisões-e-testes)
10. [Custo e desempenho](#custo-e-desempenho)
11. [Git e CI](#git-e-ci)
12. [Deploy](#deploy)
13. [Trade-offs e limitações](#trade-offs-e-limitações)
14. [O que eu faria com mais tempo](#o-que-eu-faria-com-mais-tempo)

Documentação detalhada em [`docs/`](docs): [arquitetura](docs/architecture.md), [agent](docs/agent.md), [regras](docs/business-rules.md), [API](docs/api.md), [segurança](docs/security.md), [testes](docs/testing.md), [deploy](docs/deployment.md) e [decisões](docs/decisions).

## Como rodar

Requisitos: Node 22+, pnpm 12 (versão fixada em `packageManager`) e PostgreSQL 15+ (local ou Neon).

```bash
pnpm install
cp .env.example .env.local      # preencha DATABASE_URL e ANTHROPIC_API_KEY
pnpm db:setup                   # migrações + seed (idempotente)
pnpm dev                        # http://localhost:3000
```

### Acesso de demonstração

Este é um ambiente com **dados fictícios** e o login é de demonstração (`DEMO_AUTH_ENABLED=true`): qualquer e-mail da tabela abaixo entra com **qualquer senha não vazia**. A tela de login não exibe esse aviso de propósito, para ficar igual a um produto real; a informação fica aqui. E-mails fora do seed não entram.

| Perfil      | E-mail                      | Observação                                                    |
| ----------- | --------------------------- | ------------------------------------------------------------- |
| Funcionária | `ana.souza@nexo.com.br`     | Windows 11, chamados abertos, vencido e resolvido             |
| Funcionária | `carla.mendes@nexo.com.br`  | Windows 10, outros chamados                                   |
| Funcionário | `bruno.tavares@nexo.com.br` | Também: diego.ramos, elisa.prado, fabio.nunes, gabriela.rocha |
| Analista N2 | `rafael.lima@nexo.com.br`   | Console do analista                                           |
| Analista N1 | `marina.costa@nexo.com.br`  | Útil para testar dois analistas ao mesmo tempo                |

Sem `ANTHROPIC_API_KEY`, o agent informa que está indisponível (nada de respostas inventadas) e o funcionário ainda consegue pedir um analista. Para desenvolver sem chave existe `NEXO_SCRIPTED_MODEL=true`, um modelo determinístico de teste que dirige o agent real, as ferramentas reais e o banco real por roteiros fixos. Ele é recusado se rodar na Vercel.

Variáveis de ambiente: veja [`.env.example`](.env.example), que documenta cada uma.

## Jornadas principais

**Funcionário (telas 1, 2, 3 e 6)**

1. Entra com o e-mail corporativo. "Manter conectado" estende a sessão de 12 horas para 30 dias.
2. Tira uma dúvida: o agent busca na central de ajuda e confere se o artigo vale para o computador dele (o artigo do erro 809 só vale para Windows 10).
3. Pergunta "como está meu chamado?" sem saber o número: o agent lista os chamados dele para escolher e mostra o cartão com status e prazo. Se o prazo venceu, oferece chamar um analista.
4. Abre um chamado conversando: o agent pergunta o que falta (com respostas rápidas), verifica duplicidade, calcula prioridade e prazo pelas regras e mostra um rascunho. O chamado só existe depois de **Confirmar** (botão ou texto).
5. Complementa ou reabre um chamado (resolvido há até 7 dias), também com rascunho e confirmação.
6. Pede um analista a qualquer momento (pelo chat ou pelo menu ⋯, que funciona mesmo sem o modelo de IA).
7. Volta outro dia: a conversa continua de onde parou; conversas encerradas ficam em "Conversas anteriores".

**Analista (telas 4 e 5)**

1. Vê a fila com filtros (Todas, Para você, Com o agent, Minhas), busca por nome, número de chamado ou texto, não lidas e prazo de resposta da transferência.
2. Abre a conversa: histórico completo, o resumo da transferência e os chamados do funcionário no painel lateral.
3. **Assumir atendimento**: atômico; se dois analistas clicarem juntos, só um consegue. O agent fica pausado no servidor.
4. Conversa com o funcionário, atualiza chamados (status e nota, renovando o prazo), **Devolve ao agent** ou **Encerra**. Encerrar a conversa não muda o status dos chamados.

## Arquitetura

Um único app Next.js com módulos bem separados. Não há servidor Node separado: as rotas de API rodam como funções Node na Vercel.

```
┌──────────────── Interface (React, src/app + src/components) ───────────────┐
│ Login · Chat do funcionário · Perfil · Console do analista                 │
└──────────────┬──────────────────────────────────────────────┬──────────────┘
               │ NDJSON streaming (turno do agent)            │ JSON + polling
┌──────────────▼────────────── API (src/app/api, src/server/http.ts) ────────▼┐
│ sessão · autorização · validação (Zod) · rate limit · erros tipados        │
└───────┬───────────────────────┬────────────────────────────┬───────────────┘
        │                       │                            │
┌───────▼────────┐   ┌──────────▼───────────┐   ┌────────────▼──────────────┐
│ Agent (Mastra) │──▶│ Casos de uso          │──▶│ Serviço de chamados        │
│ src/server/    │   │ conversas, rascunhos, │   │ src/server/tickets         │
│ agent          │   │ transferências        │   │ (gateway: timeout, retry,  │
│ ferramentas    │   │ src/server/           │   │  circuit breaker)          │
│ tipadas        │   │ conversations         │   └────────────┬──────────────┘
└───────┬────────┘   └──────────┬───────────┘                │
        │            ┌──────────▼──────────────── Domínio (src/domain) ───────┐
        │            │ prioridade · SLA · duplicidade · reabertura · estados  │
        │            └─────────────────────────────────────────────────────────┘
┌───────▼──────────────────────── PostgreSQL (Drizzle, migrações) ────────────┐
│ users · sessions · conversations · messages · tickets · ticket_events ·     │
│ ticket_drafts · handoffs · agent_turns · agent_actions · agent_decisions ·  │
│ knowledge_articles · analyst_presence · audit_events · rate_limits          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **`src/domain`**: regras puras e testáveis (sem banco, sem framework).
- **`src/server/tickets`**: o "sistema de chamados", separado do agent. Hoje persiste no Postgres; a troca por uma API corporativa real é um adaptador novo atrás do mesmo gateway ([como mapear](docs/architecture.md#integração-com-um-sistema-de-chamados-real)).
- **`src/server/agent`**: Mastra Agent, ferramentas, montagem de contexto e o executor do turno.
- **`src/server/conversations`**: máquina de estados, transferência, fila do analista.
- **`src/components`**: interface. Nenhuma regra de negócio mora em componente.

Mais detalhes, incluindo o modelo de dados, em [docs/architecture.md](docs/architecture.md).

## Como o agent decide

O modelo propõe; a aplicação decide se é permitido.

1. O turno começa no servidor numa transação com a conversa travada: confere dono, estado (agent ou humano), limite de 30 mensagens, se já há um turno em andamento e os limites de uso.
2. O contexto enviado ao modelo é curto e determinístico: instruções do service desk, fatos do turno (nome, área, sistema operacional, hora no fuso do service desk, rascunho pendente, chamado em foco) e as 16 mensagens mais recentes. Resultados antigos de ferramentas não são reenviados, apenas um resumo legível ("cartão do INC-20311 exibido").
3. O agent escolhe ferramentas tipadas (Zod). A identidade vem da sessão, nunca de um argumento do modelo.

| Ferramenta                 | O que faz                                                                      |
| -------------------------- | ------------------------------------------------------------------------------ |
| `consultar_meus_chamados`  | Lista os chamados do funcionário; opcionalmente mostra a seleção               |
| `consultar_chamado`        | Busca um chamado dele pelo número, mostra o cartão e calcula o prazo           |
| `buscar_central_de_ajuda`  | Busca full-text nos artigos e indica se valem para o computador do funcionário |
| `classificar_prioridade`   | Aplica a regra de prioridade/SLA a partir de impacto e urgência                |
| `verificar_duplicidade`    | Procura chamado aberto parecido ou resolvido há até 7 dias                     |
| `montar_rascunho`          | Cria o rascunho (recusa se houver duplicado aberto) e calcula prioridade/prazo |
| `preparar_atualizacao`     | Prepara complemento ou reabertura de um chamado dele                           |
| `confirmar_rascunho`       | Confirma um rascunho que o funcionário já viu, quando ele confirma por texto   |
| `oferecer_opcoes`          | Mostra respostas rápidas                                                       |
| `transferir_para_analista` | Transfere com resumo, motivo e prazo de resposta                               |
| `registrar_decisao`        | Registra entendimento, ação, segurança e motivo do turno                       |

Garantias que **não** dependem do prompt:

- Prioridade e prazo vêm do domínio; o modelo só informa impacto e urgência.
- O rascunho é recusado se existir chamado aberto muito parecido (o modelo tem de oferecer atualização).
- Criar, atualizar e reabrir só acontece por um rascunho confirmado pelo funcionário. A confirmação é idempotente.
- Chamado crítico confirmado vai direto para um analista.
- Ferramentas que alteram estado conferem, na hora de executar, se a conversa ainda está com o agent. Se um analista assumir no meio do turno, a resposta é descartada.
- Chamados de outro funcionário simplesmente não existem para o agent.

Detalhes, instruções do sistema e exemplos em [docs/agent.md](docs/agent.md).

## Transparência das decisões

Acima de cada resposta aparecem as ações executadas ("consultou seus chamados", "calculou o prazo", "montou o rascunho"). Elas são lidas de `agent_actions`: se a ferramenta não rodou, a etiqueta não existe; se falhou, aparece como falha.

**Por quê?** abre o registro do turno:

- **O que entendeu**: intenção e entendimento em uma frase.
- **O que decidiu** e **por quê**, citando fatos das ferramentas e as regras aplicadas.
- **Segurança**: alta, média ou baixa. Não há percentual inventado; "baixa" significa que o agent deveria perguntar ou transferir, e a fila destaca essas conversas.
- **Ações executadas**, com resumo e duração. O analista também vê entradas e saídas de cada ferramenta, modelo, latência e tokens.

Se o modelo não registrar a própria decisão, o sistema grava uma reconstruída a partir das ações e marca isso no painel. Nada de raciocínio interno do modelo é exposto.

## Regras do service desk

Implementadas em `src/domain` e cobertas por testes.

| Prioridade | Quando                                                      | Prazo (1ª resposta e cada atualização) |
| ---------- | ----------------------------------------------------------- | -------------------------------------- |
| Crítica    | Algo parado para uma equipe ou para a empresa               | 1 hora corrida (plantão 24h)           |
| Alta       | Impede uma pessoa de trabalhar, ou compromisso no mesmo dia | 4 horas úteis                          |
| Média      | Atrapalha, mas há alternativa                               | 3 dias úteis                           |
| Baixa      | Pedidos e melhorias sem urgência                            | 5 dias úteis                           |

- Calendário: seg a sex, 8h às 18h, fuso `America/Sao_Paulo` (configurável), feriados por variável de ambiente. "3 dias úteis" = 30 horas úteis.
- O prazo recomeça a cada atualização do service desk (analista ou reabertura). Complemento do funcionário não renova o prazo.
- Sem duplicidade: chamado aberto parecido é atualizado; resolvido há até 7 dias pode ser reaberto; depois disso, abre-se um novo.
- Transferência: pedido do funcionário, caso crítico, chamado vencido (com aceite) ou baixa segurança do agent.
- Escopo: só TI. RH, financeiro e facilities são redirecionados com base no artigo "Assuntos fora da TI".

Tabela completa de estados e transições em [docs/business-rules.md](docs/business-rules.md).

## Persistência, tempo real e histórico

- **Postgres é a fonte da verdade** para conversas, mensagens, chamados, estado (agent ou analista), rascunhos, decisões e auditoria. Sobrevive a refresh, reinício e novo deploy. `localStorage` guarda apenas o rascunho de texto não enviado.
- **Migrações versionadas** (`drizzle/`) e **seed idempotente** (`on conflict do nothing`): rodar de novo não duplica nem desfaz alterações reais.
- **Agent → funcionário**: streaming NDJSON da própria resposta do turno (ações e texto em tempo real).
- **Funcionário ↔ analista**: _polling_ curto e incremental (`?after=<seq>`, a cada 3–5 s, só com a aba visível, e imediato quando a aba volta ou a rede reconecta). Cada mensagem trava a linha da conversa antes de receber o `seq`, então a ordem do `seq` é a ordem de commit e o cursor nunca pula uma mensagem que confirmou atrasada. Não é WebSocket; escolhi isso porque funciona em funções serverless sem um serviço de tempo real extra, e a carga por consulta é um índice. A troca por push está em [trade-offs](#trade-offs-e-limitações).
- **Turno interrompido**: se a função morrer no meio de uma resposta, o turno fica "em andamento" no banco. Depois de 2 minutos (mais que o limite de 60 s da rota) ele é encerrado como abandonado na próxima leitura: a cota volta, o funcionário vê que a resposta foi interrompida e uma resposta tardia é descartada.
- **"Escrevendo…" entre pessoas**: enquanto o funcionário ou o analista digita, o navegador avisa o servidor no máximo a cada 3 s; o outro lado vê os três pontinhos animados (sem texto) em até ~2 s, pelo mesmo polling. O sinal vale 6 s, some quando a mensagem é gravada (no mesmo commit) ou quando o texto é apagado, e só é aceito de quem está na conversa (o funcionário dela ou o analista que assumiu).
- **Resposta da IA em tempo real**: o texto aparece conforme o modelo gera, com cursor piscando, na mesma bolha que vira a mensagem final (sem piscar nem pular). O analista vê os pontinhos do Nexo Assist enquanto há um turno em andamento.
- **Estados honestos**: "Assistente online / instável / indisponível" vem da configuração e de como terminaram os últimos turnos do serviço; "Enviando…" até o servidor confirmar; "processando" só quando existe turno em andamento no banco; o indicador de digitação do assistente só aparece quando a mensagem vai para o agent. Reenviar depois de uma queda reutiliza o id do cliente, então o servidor grava uma vez.
- **Histórico infinito**: abre na página mais recente (30 mensagens) e carrega as anteriores ao rolar para cima, com cursor estável (`seq` monotônico) e âncora de rolagem para não pular. Mensagens novas não puxam a tela se você estiver lendo o passado; aparece "Nova mensagem".

## Autenticação, autorização e segurança

- **Login de demonstração** (`DEMO_AUTH_ENABLED=true`): só e-mails do seed entram, com qualquer senha não vazia. Isso é **deliberadamente inseguro** e só serve para dados fictícios. A camada é substituível por SSO/OIDC corporativo ([como](docs/security.md#substituir-o-login-de-demonstração)).
- Sessões no Postgres com hash do token; cookie HttpOnly, SameSite=Lax, Secure em produção; logout revoga a sessão.
- Autorização central (`src/server/auth/policies.ts`): funcionário só vê o que é dele; recurso de outra pessoa responde 404. Analistas acessam o que o atendimento exige.
- Mutações exigem `Origin` do próprio site (CSRF), corpo limitado, validação Zod, mensagens limitadas a 2.000 caracteres.
- Conteúdo de artigos e chamados é tratado como dado, não instrução; o modelo não executa SQL nem escreve no banco diretamente.
- Content-Security-Policy com nonce por requisição (`script-src 'nonce-…' 'strict-dynamic'`, sem `object`, sem _framing_), HSTS em produção; um novo login revoga a sessão anterior do navegador; sair do console tira o analista de "online" na hora.
- Chaves só no servidor (nunca `NEXT_PUBLIC_*`), cabeçalhos de segurança, logs estruturados sem conteúdo de mensagens.

Detalhes em [docs/security.md](docs/security.md).

## Qualidade das decisões e testes

```bash
pnpm test              # unitários + integração (Postgres de teste isolado)
pnpm test:e2e          # Playwright, desktop e celular, app real + modelo determinístico
pnpm eval:agent        # 15 cenários do PRD contra o modelo real (precisa da chave)
pnpm verify            # formatação, lint, tipos, testes e build
```

- **Unitários (43)**: limites do SLA (fim de semana, antes/depois do expediente, horário de fechamento, feriado, crítico 24h), prioridade, duplicidade, janela de reabertura, máquina de estados, componentes e formatação de datas.
- **Integração (33)**: isolamento entre funcionários, numeração concorrente, confirmação idempotente com cliques simultâneos, claim concorrente, paginação de 120 mensagens, ordem de commit do `seq`, turno abandonado, contagens da fila, ferramenta negada após o analista assumir, limite da sessão, falha do provedor sem consumir cota, limite por minuto, retry e indisponibilidade do serviço de chamados.
- **E2E (14)**: login e sessão, perfil, isolamento via API, CSRF, CSP sem violações, rotação de sessão, "escrevendo…" nos dois sentidos com dois navegadores e resposta da IA em tempo real, jornada completa consulta → vencido → transferência → analista assume → responde → devolve, abertura de chamado só após confirmar, histórico de 110 mensagens com rolagem infinita, e layouts de celular.
- **Avaliação do agent**: `tests/eval/agent-eval.test.ts` cobre os 15 cenários do PRD (VPN no Windows 10 e 11, duplicado, reabertura dentro e fora dos 7 dias, reunião no mesmo dia, queda geral, pedido de monitor, status sem número, prazo vencido, pedido de analista, mensagem vaga, assunto de RH, sistema fora do ar, chamado de outra pessoa). Verifica ferramentas usadas, rascunhos e estado final, nunca o texto exato.

O CI roda tudo menos a avaliação com o modelo real, que é paga e fica como passo manual. Resultados atuais em [docs/testing.md](docs/testing.md).

## Custo e desempenho

- Modelo padrão `claude-haiku-5-5` (configurável em `LLM_MODEL`): bom uso de ferramentas e de português com baixa latência e custo. As decisões críticas não dependem dele.
- Contexto limitado (16 mensagens + fatos do turno), `maxOutputTokens` 1.200, no máximo 8 passos por turno, timeout de 45 s.
- Limites no Postgres, compartilhados entre instâncias: 8 turnos/min e 150/dia por funcionário, teto global diário configurável, 20 logins/10 min por IP. Recomenda-se também um limite de gasto no console do provedor.
- Latência e tokens de cada turno ficam em `agent_turns`; os números da tela de login são calculados disso (e omitidos sem amostra suficiente).
- Consultas indexadas, paginação por cursor, sem N+1 nas páginas de mensagens e na fila, pool pequeno de conexões para serverless. A fila do analista foi medida com 150 mil conversas e 1,2 milhão de mensagens: contagens de 25,9 ms para 0,8 ms e lista de 29 ms para 6,6 ms ([como medir](docs/testing.md#desempenho-da-fila-do-analista)).

## Git e CI

- Só duas branches: `dev` (integração, onde os commits entram) e `main` (estável, produção). Release por PR `dev → main`.
- Issues por marco (#1–#7), PRs ligados a elas.
- GitHub Actions: formatação, lint, tipos, unitários, integração (Postgres de serviço) e build; um segundo job roda o Playwright contra o build de produção.

## Deploy

Pensado para **um projeto Vercel + Neon**, sem servidor extra. Passo a passo em [docs/deployment.md](docs/deployment.md):

1. Criar o banco no Neon e usar a URL _pooled_ como `DATABASE_URL`.
2. Configurar as variáveis na Vercel (chaves como _Sensitive_).
3. `pnpm db:setup` contra o Neon (migrações são um passo explícito de release).
4. Conectar o repositório: `main` em produção, demais branches em preview.

**Estado:** publicado em https://nexo-assist-two.vercel.app a partir de `main`. Rollback e verificação em [docs/deployment.md](docs/deployment.md#estado).

## Trade-offs e limitações

- **Polling em vez de WebSocket** entre funcionário e analista: simples e confiável na Vercel; custa até ~3 s de atraso e algumas consultas leves. Com mais escala, trocaria por um provedor de pub/sub (Ably, Pusher ou Neon logical replication) mantendo o mesmo cursor.
- **Memória própria em vez da memória do Mastra**: o histórico já está no Postgres com o modelo de dados do produto (blocos, rascunhos, decisões). Reconstruir o contexto a partir dele evita duas fontes da verdade. Conversas muito longas usam só as 16 últimas mensagens mais os fatos do turno; um resumo incremental gerado pelo modelo seria o próximo passo.
- **Busca full-text em vez de vetorial**: com 10 artigos, o full-text em português com stemming é suficiente, determinístico e grátis.
- **Login de demonstração** aceita qualquer senha para e-mails do seed. Inaceitável com dados reais.
- **Circuit breaker por instância**: protege cada função, não coordena entre instâncias.
- **"Segurança" do agent é declarada pelo modelo**, não calibrada estatisticamente; por isso é qualitativa e acompanhada das ações que a sustentam.
- **Presença do analista** por heartbeat de 60 s; "online" significa "console aberto e disponível nos últimos 2 minutos" (sair zera na hora; fechar a aba leva até 2 minutos).
- **Lido/não lido** na fila é compartilhado entre analistas (um marcador por conversa), não individual.
- **"Escrevendo…" por polling**: aparece com até ~2 s de atraso; instantâneo exigiria um canal de push (WebSocket).

## O que eu faria com mais tempo

- SSO corporativo (OIDC) e papéis N1/N2 com filas separadas.
- Push em tempo real e notificações para o analista.
- Resumo incremental da conversa e avaliação contínua das decisões (scores do Mastra sobre turnos reais).
- Adaptador para o sistema de chamados corporativo real, com outbox para mutações.
- Painel de métricas (resolução sem fila, SLA cumprido, custo por conversa).
- Testes de carga para o cenário de 2.000 funcionários (não foram executados).
