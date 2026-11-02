# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema numa conversa e o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados (sempre com confirmação) e chama um analista quando precisa. O analista recebe as conversas transferidas num console, assume o atendimento com o agent pausado e devolve ou encerra quando termina.

Tudo o que aparece depois do login é estado real: mensagens, chamados, transferências e decisões do agent ficam no Postgres. Os dados de exemplo vêm do seed: funcionários, analistas, artigos, chamados históricos e um **histórico de conversas de demonstração** (abaixo).

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript estrito · Mastra · Anthropic Claude · PostgreSQL (Neon) · Drizzle · Tailwind 4 · Vitest · Playwright
- **Deploy:** um único projeto Vercel + Neon. Veja [Deploy](#deploy) para o estado atual.

## Sumário

1. [Como rodar](#1.-como-rodar)
2. [Jornadas principais](#2.-jornadas-principais)
3. [Arquitetura](#3.-arquitetura)
4. [Como o agent decide](#4.-como-o-agent-decide)
5. [Transparência das decisões](#5.-transparência-das-decisões)
6. [Regras do service desk](#6.-regras-do-service-desk)
7. [Persistência, tempo real e histórico](#7.-persistência-tempo-real-e-histórico)
8. [Autenticação, autorização e segurança](#8.-autenticação-autorização-e-segurança)
9. [Qualidade das decisões e testes](#9.-qualidade-das-decisões-e-testes)
10. [Custo e desempenho](#10.-custo-e-desempenho)
11. [Git e CI](#11.-git-e-ci)
12. [Deploy](#12.-deploy)
13. [Trade-offs e limitações](#13.-trade-offs-e-limitações)
14. [O que faria com mais tempo](#14-o-que-faria-com-mais-tempo)

Documentação detalhada em [`docs/`](docs): [arquitetura](docs/architecture.md), [agent](docs/agent.md), [regras](docs/business-rules.md), [API](docs/api.md), [segurança](docs/security.md), [testes](docs/testing.md), [deploy](docs/deployment.md) e [decisões](docs/decisions).

## 1. Como rodar

Requisitos: Node 22+, pnpm 12 (versão fixada em `packageManager`) e PostgreSQL 15+ (local ou Neon).

```bash
pnpm install
cp .env.example .env.local      # preencha DATABASE_URL e ANTHROPIC_API_KEY
pnpm db:setup                   # migrações + seed (idempotente)
pnpm dev                        # http://localhost:3000
```

### Acesso de demonstração

Este é um ambiente com **dados fictícios** e o login é de demonstração (`DEMO_AUTH_ENABLED=true`): qualquer e-mail da tabela abaixo entra com **qualquer senha não vazia**. A tela de login não exibe esse aviso de propósito, para ficar igual a um produto real; a lista de contas e o aviso sobre a senha ficam aqui e na página **Privacidade e uso de dados** (`/privacidade`, link no rodapé do login), que lê as contas ativas do banco e só mostra a seção enquanto `DEMO_AUTH_ENABLED=true`. E-mails fora do seed não entram.

| Perfil      | E-mail                      | Observação                                                    |
| ----------- | --------------------------- | ------------------------------------------------------------- |
| Funcionária | `ana.souza@nexo.com.br`     | Windows 11, chamados abertos, vencido e resolvido             |
| Funcionária | `carla.mendes@nexo.com.br`  | Windows 10, outros chamados                                   |
| Funcionário | `bruno.tavares@nexo.com.br` | Também: diego.ramos, elisa.prado, fabio.nunes, gabriela.rocha |
| Analista N2 | `rafael.lima@nexo.com.br`   | Console do analista                                           |
| Analista N1 | `marina.costa@nexo.com.br`  | Útil para testar dois analistas ao mesmo tempo                |

Sem `ANTHROPIC_API_KEY`, o agent informa que está indisponível (nada de respostas inventadas) e o funcionário ainda consegue pedir um analista. Para desenvolver sem chave existe `NEXO_SCRIPTED_MODEL=true`, um modelo determinístico de teste que dirige o agent real, as ferramentas reais e o banco real por roteiros fixos. Ele é recusado se rodar na Vercel.

Variáveis de ambiente: veja [`.env.example`](.env.example), que documenta cada uma.

## 2. Jornadas principais

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

## 3. Arquitetura

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

## 4. Como o agent decide

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

## 5. Transparência das decisões

Acima de cada resposta aparecem as ações executadas ("consultou seus chamados", "calculou o prazo", "montou o rascunho"). Elas são lidas de `agent_actions`: se a ferramenta não rodou, a etiqueta não existe; se falhou, aparece como falha.

**Por quê?** abre o registro do turno:

- **O que entendeu**: intenção e entendimento em uma frase.
- **O que decidiu** e **por quê**, citando fatos das ferramentas e as regras aplicadas.
- **Segurança**: alta, média ou baixa. Não há percentual inventado; "baixa" significa que o agent deveria perguntar ou transferir, e a fila destaca essas conversas.
- **Ações executadas**, com resumo e duração. O analista também vê entradas e saídas de cada ferramenta, modelo, latência e tokens.

Se o modelo não registrar a própria decisão, o sistema grava uma reconstruída a partir das ações e marca isso no painel. Nada de raciocínio interno do modelo é exposto.

## 6. Regras do service desk

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

## 7. Persistência, tempo real e histórico

- **Postgres é a fonte da verdade** para conversas, mensagens, chamados, estado (agent ou analista), rascunhos, decisões e auditoria. Sobrevive a refresh, reinício e novo deploy. `localStorage` guarda apenas o rascunho de texto não enviado.
- **Migrações versionadas** (`drizzle/`) e **seed idempotente** (`on conflict do nothing`): rodar de novo não duplica nem desfaz alterações reais.
- **Agent → funcionário**: streaming NDJSON da própria resposta do turno (ações e texto em tempo real).
- **Funcionário ↔ analista**: _polling_ curto e incremental (`?after=<seq>`, a cada 3–5 s, só com a aba visível, e imediato quando a aba volta ou a rede reconecta). Cada mensagem trava a linha da conversa antes de receber o `seq`, então a ordem do `seq` é a ordem de commit e o cursor nunca pula uma mensagem que confirmou atrasada. Não é WebSocket; escolhi isso porque funciona em funções serverless sem um serviço de tempo real extra, e a carga por consulta é um índice. A troca por push está em [trade-offs](#trade-offs-e-limitações).
- **Turno interrompido**: se a função morrer no meio de uma resposta, o turno fica "em andamento" no banco. Depois de 2 minutos (mais que o limite de 60 s da rota) ele é encerrado como abandonado na próxima leitura: a cota volta, o funcionário vê que a resposta foi interrompida e uma resposta tardia é descartada.
- **"Escrevendo…" entre pessoas**: enquanto o funcionário ou o analista digita, o navegador avisa o servidor no máximo a cada 3 s; o outro lado vê os três pontinhos animados (sem texto) em até ~2 s, pelo mesmo polling. O sinal vale 6 s, some quando a mensagem é gravada (no mesmo commit) ou quando o texto é apagado, e só é aceito de quem está na conversa (o funcionário dela ou o analista que assumiu).
- **Não lidas e presença**: cada conversa da fila mostra quantas mensagens do funcionário o analista ainda não viu; o ícone do console e o título da aba ("(3) Console…") somam as conversas aguardando atendente e as do próprio analista com não lidas. O funcionário vê "(1) Atendimento" quando chega resposta com a aba em segundo plano. "online" do funcionário (bolinha verde e "online · área") significa chat aberto e visível nos últimos 20 s, gravado a partir do próprio polling (no máximo uma escrita a cada 10 s); na fila, "digitando…" vem do mesmo sinal real de digitação.
- **Histórico de demonstração**: `pnpm db:seed` também grava seis conversas profissionais sobre os chamados do seed (consulta com prazo vencido e transferência para N2, acesso urgente ao SAP aguardando analista, agent com segurança baixa pedindo informação, orientação pela central de ajuda, caso resolvido só pelo agent, caso assumido e encerrado por um analista). Elas seguem o mesmo caminho do produto: turno, ações, decisão ("Por quê?" funciona), cartões a partir dos chamados reais, transferência pelo mesmo caso de uso (com evento no chamado). São idempotentes e não destrutivas: quem já tem qualquer conversa não recebe nenhuma. Os turnos usam o modelo `demo-seed` e ficam fora das métricas da tela de login e da saúde do assistente. Os testes automáticos não carregam esse histórico.
- **Fila que diz o que fazer**: a linha de cada conversa mostra o próximo passo a partir do estado gravado: "Crítico · contato em 25 min", "Transferida · contato atrasado há 10 min", "Você está atendendo · aguarda sua resposta" (o funcionário escreveu por último), "Agent respondendo…" (turno em andamento), "Encerrada por Marina", "Atendida só pelo agent". "Para você" é ordenada pelo prazo de primeiro contato mais próximo (vencidos primeiro), não por quem escreveu por último. O painel de chamados pode ser escondido em telas largas (preferência guardada no navegador).
- **Resposta da IA em tempo real**: o texto aparece conforme o modelo gera, com cursor piscando, na mesma bolha que vira a mensagem final (sem piscar nem pular). O analista vê os pontinhos do Nexo Assist enquanto há um turno em andamento.
- **Estados honestos**: "Assistente online / instável / indisponível" vem da configuração e de como terminaram os últimos turnos do serviço; "Enviando…" até o servidor confirmar; "processando" só quando existe turno em andamento no banco; o indicador de digitação do assistente só aparece quando a mensagem vai para o agent. Reenviar depois de uma queda reutiliza o id do cliente, então o servidor grava uma vez.
- **Histórico infinito**: abre na página mais recente (30 mensagens) e carrega as anteriores ao rolar para cima, com cursor estável (`seq` monotônico) e âncora de rolagem para não pular. Mensagens novas não puxam a tela se você estiver lendo o passado; aparece "Nova mensagem".

## 8. Autenticação, autorização e segurança

- **Login de demonstração** (`DEMO_AUTH_ENABLED=true`): só e-mails do seed entram, com qualquer senha não vazia. Isso é **deliberadamente inseguro** e só serve para dados fictícios. A camada é substituível por SSO/OIDC corporativo ([como](docs/security.md#substituir-o-login-de-demonstração)).
- Sessões no Postgres com hash do token; cookie HttpOnly, SameSite=Lax, Secure em produção; logout revoga a sessão.
- Autorização central (`src/server/auth/policies.ts`): funcionário só vê o que é dele; recurso de outra pessoa responde 404. Analistas acessam o que o atendimento exige.
- Mutações exigem `Origin` do próprio site (CSRF), corpo limitado, validação Zod, mensagens limitadas a 2.000 caracteres.
- Conteúdo de artigos e chamados é tratado como dado, não instrução; o modelo não executa SQL nem escreve no banco diretamente.
- Content-Security-Policy com nonce por requisição (`script-src 'nonce-…' 'strict-dynamic'`, sem `object`, sem _framing_), HSTS em produção; um novo login revoga a sessão anterior do navegador; sair do console tira o analista de "online" na hora.
- Chaves só no servidor (nunca `NEXT_PUBLIC_*`), cabeçalhos de segurança, logs estruturados sem conteúdo de mensagens.

Detalhes em [docs/security.md](docs/security.md).

## 9. Qualidade das decisões e testes

```bash
pnpm test              # unitários + integração (Postgres de teste isolado)
pnpm test:e2e          # Playwright, desktop e celular, app real + modelo determinístico
pnpm eval:agent        # 15 cenários do PRD contra o modelo real (precisa da chave)
pnpm verify            # formatação, lint, tipos, testes e build
```

- **Unitários (46)**: limites do SLA (fim de semana, antes/depois do expediente, horário de fechamento, feriado, crítico 24h), prioridade, duplicidade, janela de reabertura, máquina de estados, componentes e formatação de datas.
- **Integração (44)**: isolamento entre funcionários, numeração concorrente, confirmação idempotente com cliques simultâneos, claim concorrente, paginação de 120 mensagens, ordem de commit do `seq`, turno abandonado, contagens da fila, ferramenta negada após o analista assumir, limite de 30 mensagens por sessão (inclusive com o analista), nova conversa no limite, consulta com 0 ou 1 chamado sem pedir escolha, histórico de demonstração em ordem cronológica, falha do provedor, limite por minuto, retry e indisponibilidade do serviço de chamados.
- **E2E (14)**: login e sessão, perfil, isolamento via API, CSRF, CSP sem violações, rotação de sessão, "escrevendo…" nos dois sentidos com dois navegadores e resposta da IA em tempo real, jornada completa consulta → vencido → transferência → analista assume → responde → devolve, abertura de chamado só após confirmar, histórico de 110 mensagens com rolagem infinita, e layouts de celular.
- **Avaliação do agent**: `tests/eval/agent-eval.test.ts` cobre os 15 cenários do PRD (VPN no Windows 10 e 11, duplicado, reabertura dentro e fora dos 7 dias, reunião no mesmo dia, queda geral, pedido de monitor, status sem número, prazo vencido, pedido de analista, mensagem vaga, assunto de RH, sistema fora do ar, chamado de outra pessoa). Verifica ferramentas usadas, rascunhos e estado final, nunca o texto exato.

O CI roda tudo menos a avaliação com o modelo real, que é paga e fica como passo manual. Resultados atuais em [docs/testing.md](docs/testing.md).

## 10. Custo e desempenho

- Modelo padrão `claude-haiku-5-5` (configurável em `LLM_MODEL`): bom uso de ferramentas e de português com baixa latência e custo. As decisões críticas não dependem dele.
- Contexto limitado (16 mensagens + fatos do turno), `maxOutputTokens` 1.200, no máximo 8 passos por turno, timeout de 45 s.
- Limites no Postgres, compartilhados entre instâncias: 8 turnos/min e 150/dia por funcionário, teto global diário configurável, 20 logins/10 min por IP. Recomenda-se também um limite de gasto no console do provedor.
- Latência e tokens de cada turno ficam em `agent_turns`; os números da tela de login são calculados disso (e omitidos sem amostra suficiente).
- O cartão "Agora no service desk" da tela de login também é real e anônimo (a página é pública): quando foi o último atendimento e quais passos o assistente deu, categoria/prioridade/prazo do último chamado aberto por ele e os totais do dia. Sem nomes, textos, títulos ou números de chamado; o histórico de demonstração não entra.
- Consultas indexadas, paginação por cursor, sem N+1 nas páginas de mensagens e na fila, pool pequeno de conexões para serverless. A fila do analista foi medida com 150 mil conversas e 1,2 milhão de mensagens: contagens de 25,9 ms para 0,8 ms e lista de 29 ms para 6,6 ms ([como medir](docs/testing.md#desempenho-da-fila-do-analista)).

## 11. Git e CI

- Só duas branches: `dev` (integração, onde os commits entram) e `main` (estável, produção). Release por PR `dev → main`.
- Issues por marco (#1–#7), PRs ligados a elas.
- GitHub Actions: formatação, lint, tipos, unitários, integração (Postgres de serviço) e build; um segundo job roda o Playwright contra o build de produção.

## 12. Deploy

**Vercel + Neon**, sem servidor extra. Runbook completo, com todos os comandos, em [docs/deployment.md](docs/deployment.md).

- **Banco:** Neon `nexo-assist` (`aws-sa-east-1`), só o branch `main`. A aplicação usa a string _pooled_; migração e seed usam a direta.
- **Aplicação:** projeto Vercel `nexo-assist`, ligado ao GitHub com `main` como branch de produção.
- **Deploy automático:** todo commit que chega em `main` (merge do PR `dev → main`) publica a produção sozinho. Push em `dev` gera só um preview de build.
- **Release:** `dev` → PR para `main` → CI verde → `pnpm db:migrate` no Neon se houver migração nova (antes do merge) → merge → conferir `GET /api/health`.

**Estado:** publicado em https://nexo-assist-two.vercel.app a partir de `main`. Rollback e verificação em [docs/deployment.md](docs/deployment.md#5-ponto-de-restauração-e-rollback).

## 13. Trade-offs e limitações

- **Polling em vez de WebSocket** entre funcionário e analista: simples e confiável na Vercel; custa até ~2 s de atraso e algumas consultas leves. Com mais escala, trocaria por um provedor de pub/sub (Ably, Pusher ou Neon logical replication) mantendo o mesmo cursor.
- **Memória própria em vez da memória do Mastra**: o histórico já está no Postgres com o modelo de dados do produto (blocos, rascunhos, decisões). Reconstruir o contexto a partir dele evita duas fontes da verdade. Conversas muito longas usam só as 16 últimas mensagens mais os fatos do turno; um resumo incremental gerado pelo modelo seria o próximo passo.
- **Busca full-text em vez de vetorial**: com 10 artigos, o full-text em português com stemming é suficiente, determinístico e grátis.
- **Login de demonstração** aceita qualquer senha para e-mails do seed. Inaceitável com dados reais.
- **Circuit breaker por instância**: protege cada função, não coordena entre instâncias.
- **"Segurança" do agent é declarada pelo modelo**, não calibrada estatisticamente; por isso é qualitativa e acompanhada das ações que a sustentam.
- **Presença do analista** por heartbeat de 60 s; "online" significa "console aberto e disponível nos últimos 2 minutos" (sair zera na hora; fechar a aba leva até 2 minutos).
- **Lido/não lido** na fila é compartilhado entre analistas (um marcador por conversa), não individual.
- **"Escrevendo…" por polling**: aparece com até ~2 s de atraso; instantâneo exigiria um canal de push (WebSocket).

## 14. O que faria com mais tempo

Se tivesse mais tempo para desenvolver o projeto, minha prioridade seria tornar o agent mais confiável, reduzir os custos de operação e melhorar a experiência dos funcionários. Mais do que adicionar funcionalidades, gostaria de garantir que o sistema resolve problemas reais com menos intervenção dos analistas.

**Começaria pela capacidade de diagnóstico do agent.** Se um funcionário disser "Continuo com o mesmo problema de ontem", o agent deve consultar o histórico, identificar o chamado anterior e entender o que já foi feito, em vez de recomeçar ou abrir outro chamado. Também testaria mais situações em que a IA não consegue resolver, garantindo que a transferência, que hoje já pausa o agent quando o analista assume, leve sempre todo o contexto necessário.

Outro ponto importante seria **saber quanto custa de fato cada atendimento**. Os tokens, o modelo e cada chamada de ferramenta já ficam registrados por turno (`agent_turns`, `agent_actions`); faltaria transformar isso em custo por atendimento e acompanhar. Assim daria para ver, por exemplo, se estamos gastando demais com pedidos simples que um modelo mais econômico resolveria. O contexto enviado ao modelo já se limita às mensagens recentes e aos fatos do turno; o próximo passo seria um resumo incremental da conversa, para manter só o necessário sem perder qualidade.

**Na experiência de uso, o foco seria o chat.** Permitiria que o funcionário enviasse capturas de tela ou fotos do erro, porque nem sempre é fácil explicar um problema técnico por texto. Outra funcionalidade interessante seria o atendimento por voz: o funcionário explica o problema falando, o sistema converte o áudio em texto e, se necessário, responde também por voz. Com imagem e áudio, o custo desse processamento entraria na mesma medição por atendimento.

Depois, **criaria um painel para acompanhar os resultados do agent**. Não bastaria saber quantas mensagens foram trocadas ou quantos chamados foram abertos. Gostaria de saber quantos problemas a IA resolveu sem ajuda humana, quantos precisaram de um analista, quanto tempo levaram para ser resolvidos e quantos chamados foram reabertos. Se muitos funcionários voltarem com o mesmo problema depois de o agent considerá-lo resolvido, as soluções propostas não estão funcionando. Essas métricas mostrariam exatamente onde melhorar.

Também faria **testes de carga para saber até onde a infraestrutura aguenta**. O sistema foi pensado para uma empresa de cerca de 2.000 funcionários, o que não significa todos no chat ao mesmo tempo. Simularia diferentes volumes de usuários simultâneos, mensagens, respostas em streaming e consultas de atualização (polling), acompanhando tempo de resposta, duração das funções e desempenho do banco. Com esses números, daria para identificar os pontos mais lentos e decidir se é preciso aumentar recursos ou só otimizar o que já existe.

Por último, exploraria **um aplicativo desktop para ajudar no diagnóstico dos computadores**, como um componente separado desta aplicação web. Usaria Avalonia UI com C#/.NET, minha stack para aplicativos nativos, e um Windows Service separado para executar operações locais autorizadas. Se um funcionário disser "Meu computador ficou lento depois da última atualização do Windows", em vez de depender só do relato, o agent poderia pedir ao serviço local dados de CPU, memória, espaço em disco, processos e eventos do Windows, e com isso identificar melhor a causa. Operações simples, como limpar arquivos temporários autorizados, também poderiam ser executadas com as devidas permissões e com registro de tudo o que foi feito.

Não avançaria com tudo ao mesmo tempo. **Começaria pela confiabilidade do agent, pela medição de custos e pela qualidade do atendimento**, porque têm impacto direto na operação. As funcionalidades mais avançadas, como voz e diagnóstico local, viriam aos poucos, depois de avaliar o benefício real de cada uma.

No fundo, o objetivo é que o sistema não se limite a responder aos funcionários, mas resolva cada vez mais incidentes, reduza o trabalho repetitivo dos analistas e mantenha os custos sob controle.

</br></br>
---
```c
printf("Sim, este projecto foi desenvolvido com muito amor! ❤️\n");
```

**Made with ❤️, ☕ and lots of code.**
