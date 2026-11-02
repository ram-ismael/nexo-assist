# Deploy

Um projeto **Vercel** (Next.js, funções Node) e um banco **Neon** (PostgreSQL). Não há servidor separado: a interface, a API, o agent e o serviço de chamados sobem juntos no mesmo deploy.

**Resumo do fluxo:** trabalho em `dev` → PR `dev → main` → CI verde → (migração no Neon, se o release tiver uma) → merge → **a Vercel publica a produção sozinha**.

## Visão geral

| Peça                  | Valor                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| Repositório           | `github.com/ram-ismael/nexo-assist` (público)                                   |
| Branches Git          | **só `dev` e `main`**. `dev` recebe os commits; `main` é a produção             |
| Projeto Vercel        | `nexo-assist`, ligado ao GitHub, branch de produção `main`                      |
| URL de produção       | https://nexo-assist-two.vercel.app                                              |
| Projeto Neon          | `nexo-assist`, região `aws-sa-east-1`, PostgreSQL 18                            |
| Branch Neon           | **só `main`** (o padrão). Banco `neondb`, role `neondb_owner`                   |
| Conexão da aplicação  | string _pooled_ (host com `-pooler`) em `DATABASE_URL` na Vercel                |
| Conexão de manutenção | string direta (sem `-pooler`), usada só para migração e seed                    |
| CI                    | GitHub Actions (`.github/workflows/ci.yml`): `verify` e `e2e` em todo PR e push |

```
 dev ──push──► GitHub ──► CI (verify + e2e)
                     └──► Vercel: deploy de PREVIEW (só valida o build)

 PR dev → main (CI verde) ──merge──► GitHub main ──► Vercel: deploy de PRODUÇÃO automático
                                                     └─► https://nexo-assist-two.vercel.app

 Neon (main) ◄── migração/seed: passo manual, com a string direta, ANTES do merge
```

## Repositório público: o que fica fora dele

O código e a documentação são públicos; credenciais nunca entram no Git:

- strings de conexão do Neon ficam só no `.env.neon` local e nas variáveis _Sensitive_ da Vercel; chaves da Anthropic, só na Vercel;
- `.gitignore` ignora todo `.env*` (exceto o `.env.example`, sem valores) e a pasta `.neon`;
- a CI não usa segredos: roda com Postgres de serviço e o modelo roteirizado, então PRs de forks não têm o que vazar;
- deploys de PRs de forks na Vercel dependem de autorização no painel (padrão da Vercel), então código de terceiros não roda com as variáveis de produção.

Antes de um commit, `git diff --cached` não deve conter `postgres://…@`, `sk-ant-` nem tokens.

## Ferramentas na máquina

```bash
node --version        # 22 ou mais
corepack enable       # usa o pnpm fixado em package.json (packageManager)
pnpm install
npm i -g vercel       # CLI da Vercel
npm i -g neonctl      # CLI do Neon (opcional; o painel faz o mesmo)
gh auth login         # GitHub CLI, para abrir e mergear PRs
```

## 1. Banco de dados no Neon (feito uma vez)

1. Criar o projeto no Neon (painel ou `neonctl projects create --name nexo-assist --region-id aws-sa-east-1`). O branch padrão é o `main`, e é o único usado.
2. Ligar a pasta ao projeto: `neon init` gerou o `neon.ts` (política de branch) e a entrada `.neon` no `.gitignore`. Nenhuma string de conexão vai para o repositório.
3. Copiar as duas strings de conexão do branch `main` (painel do Neon → _Connect_, ou CLI):

   ```bash
   neonctl connection-string main --pooled   # pooled → DATABASE_URL da Vercel
   neonctl connection-string main            # direta → migração e seed
   ```

4. Guardar as duas, só na máquina, em `.env.neon` (ignorado pelo Git como todo `.env*`):

   ```bash
   # .env.neon
   DATABASE_URL=postgresql://…-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
   DATABASE_URL_UNPOOLED=postgresql://….c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
   NEON_BRANCH=main
   ```

5. Criar o schema e os dados de demonstração **com a string direta**:

   ```bash
   set -a; . ./.env.neon; set +a
   DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:migrate   # aplica drizzle/0000…NNNN
   DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:seed      # usuários, artigos, chamados, conversas demo
   ```

   O `DATABASE_URL` passado na linha de comando vence o `.env.local`. Os dois comandos são idempotentes: rodar de novo não duplica nem desfaz nada.

Por que duas strings: a aplicação roda em funções serverless e precisa do _pooler_ (muitas conexões curtas); migrações usam a conexão direta, sem pooler, como recomenda o Neon.

## 2. Projeto na Vercel (feito uma vez)

1. `vercel login` e, na pasta do projeto, `vercel link` → projeto `nexo-assist`. Framework detectado: Next.js; comandos de build e instalação padrão (`next build`, `pnpm install`).
2. **Ligar o GitHub:** painel da Vercel → projeto → _Settings_ → _Git_ → conectar `ram-ismael/nexo-assist`, com branch de produção `main`. A criação automática de deploys a partir de commits precisa estar ligada. Para conferir pela API:

   ```bash
   vercel api /v9/projects/nexo-assist --raw | jq '.link.productionBranch, .gitProviderOptions'
   # "main"
   # { "createDeployments": "enabled", "disableRepositoryDispatchEvents": false }
   ```

3. **Variáveis de ambiente** (_Settings_ → _Environment Variables_), todas como _Sensitive_, no ambiente **Production**:

   | Variável                      | Valor recomendado                         |
   | ----------------------------- | ----------------------------------------- |
   | `DATABASE_URL`                | string _pooled_ do Neon                   |
   | `DATABASE_POOL_MAX`           | `3`                                       |
   | `ANTHROPIC_API_KEY`           | chave da Anthropic                        |
   | `LLM_MODEL`                   | `anthropic/claude-haiku-5-5`              |
   | `LLM_GLOBAL_DAILY_TURNS`      | `500` (teto de custo; ajuste ao gasto)    |
   | `AGENT_SESSION_MESSAGE_LIMIT` | `30` (regra do PRD)                       |
   | `BUSINESS_TIMEZONE`           | `America/Sao_Paulo`                       |
   | `DEMO_AUTH_ENABLED`           | `true` (só porque os dados são fictícios) |

   Pela CLI, sem deixar o valor no histórico do shell (o valor é pedido de forma interativa):

   ```bash
   vercel env add ANTHROPIC_API_KEY production --sensitive
   vercel env ls                       # confere nomes e ambientes (valores nunca aparecem)
   ```

   As demais variáveis do [`.env.example`](../.env.example) têm padrão seguro e não precisam ser definidas. `NEXO_SCRIPTED_MODEL` e `TICKET_FAULT_RATE` são recusadas na Vercel.

4. **Limite de gasto** também no console da Anthropic (ex.: US$ 20/mês), além dos limites da própria aplicação.

**Previews:** as variáveis existem só em Production, de propósito. Um deploy de preview (push em `dev`) **compila** a aplicação e prova que o build passa na Vercel, mas não tem banco nem chave, então não é usado para testar funcionalidades: o teste funcional é local (`pnpm dev`, `pnpm test:e2e`) e, depois do merge, na produção. Assim nenhum preview escreve no banco de produção e não é preciso um segundo branch no Neon.

## 3. Release: do `dev` à produção (sempre)

**O deploy de produção é automático:** todo commit que chega em `main` no GitHub (merge do PR `dev → main` ou push direto) faz a Vercel compilar e publicar a produção em https://nexo-assist-two.vercel.app, normalmente em 1 a 2 minutos. Não é preciso rodar `vercel deploy`.

### 3.1 Trabalho em `dev`

```bash
git switch dev
git pull --ff-only origin dev
# … alterações …
pnpm verify          # formatação, lint, tipos, testes unitários e de integração, build
pnpm test:e2e        # Playwright com o modelo roteirizado (sem gasto de LLM)
git commit -m "…"
git push origin dev  # dispara a CI e um preview na Vercel
```

### 3.2 PR de release

```bash
gh pr create --base main --head dev --title "Release: …" --body "…"
gh pr checks <número> --watch    # espera verify e e2e ficarem verdes
```

### 3.3 Migração no Neon (só se o release trouxer `drizzle/00NN_*.sql` novo)

Migrações nunca rodam no build: são um passo explícito e vêm **antes do merge**, porque o código novo lê as colunas novas e o código antigo as ignora (todas as migrações do projeto são aditivas).

```bash
git diff --name-only origin/main origin/dev -- drizzle/   # há migração nova?

set -a; . ./.env.neon; set +a
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:migrate
```

Conferir o que foi aplicado (painel do Neon → _SQL Editor_, ou `psql "$DATABASE_URL_UNPOOLED"`):

```sql
select count(*) from drizzle.__drizzle_migrations;   -- igual ao número de arquivos em drizzle/*.sql
```

### 3.4 Merge = deploy

```bash
gh pr merge <número> --merge
```

O merge leva o commit para `main`, e a Vercel publica a produção sozinha. Para acompanhar:

```bash
vercel ls nexo-assist        # o deploy novo aparece como "Production", Building → Ready
gh api repos/ram-ismael/nexo-assist/commits/main/statuses --jq '.[0] | .context + ": " + .state'
```

### 3.5 Verificação pós-deploy

```bash
curl -s https://nexo-assist-two.vercel.app/api/health
# {"status":"ok","database":"ok","llm":"configured","assistant":"online","model":"anthropic/claude-haiku-5-5",…}
```

`assistant` é `online`, `degraded` (três falhas seguidas do provedor nos últimos 15 min) ou `unavailable` (sem chave ou credencial recusada).

Depois, no navegador, com duas janelas (uma anônima):

1. `ana.souza@nexo.com.br` (qualquer senha): perguntar o status dos chamados; ver os pontinhos e a resposta aparecendo aos poucos.
2. Abrir um chamado de VPN, confirmar o rascunho, pedir um analista.
3. Na outra janela, `marina.costa@nexo.com.br`: assumir; a Ana passa a ver "Marina Costa · Online".
4. Trocar mensagens (indicador de digitação dos dois lados), devolver ao agent, encerrar.

### 3.6 Depois do release

```bash
git switch dev
git pull --ff-only origin main   # traz o merge commit; dev e main ficam iguais
git push origin dev
```

## 4. Dados de demonstração

`pnpm db:seed` grava, além da base (usuários, artigos, chamados históricos), seis conversas de demonstração, uma por funcionário que **ainda não tem nenhuma conversa**. Ele nunca altera nem apaga uso real.

Para trocar conversas de teste por histórias de demonstração limpas:

1. Identificar as conversas que não vieram do seed (o seed usa o modelo `demo-seed`):

   ```sql
   select c.id, u.name, c.state, c.created_at
   from conversations c join users u on u.id = c.employee_id
   where exists (select 1 from agent_turns t where t.conversation_id = c.id and t.model <> 'demo-seed')
      or not exists (select 1 from agent_turns t where t.conversation_id = c.id);
   ```

2. Ler as conversas e confirmar que são descartáveis. Depois, um ponto de restauração (seção 5) e:

   ```sql
   delete from conversations where id in ('<id>', '<id>');
   -- o cascade remove mensagens, turnos, ações, decisões, rascunhos e transferências
   ```

3. `DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:seed` recria as histórias dos funcionários que ficaram sem conversa.

Foi assim em 2026-11-02: duas conversas de teste (Ana Souza e Bruno Tavares) foram removidas e recriadas pelo seed.

## 5. Ponto de restauração e rollback

Sem branches extras no Neon: o projeto usa só o `main`.

- **Restore por horário:** o Neon guarda o histórico das últimas **6 horas** (_history retention_). Painel do Neon → _Branches_ → `main` → _Restore_ → escolher o horário anterior à operação. Anote a hora (UTC) antes de qualquer mudança de dados.
- **Snapshot:** antes de uma operação de risco fora dessa janela, painel do Neon → _Backup & Restore_ → _Create snapshot_ do `main`. Ele é restaurável depois e não cria branch.
- **Aplicação:** painel da Vercel → _Deployments_ → deploy anterior → _Promote to Production_ (ou `vercel rollback`). Como as migrações são aditivas (índices e colunas anuláveis), o código anterior roda sobre o schema novo sem ajuste.
- **Revert pelo Git:** `git revert` em `dev`, PR para `main` e merge; a Vercel republica sozinha.

## 6. Deploy manual (exceção)

Só se a integração com o GitHub estiver fora do ar. A partir de `main` atualizado:

```bash
git switch main && git pull --ff-only origin main
vercel deploy --prod
```

## Estado atual

- Produção em https://nexo-assist-two.vercel.app, publicada a partir de `main` pela integração GitHub.
- Banco Neon `main` com as migrações `0000` a `0006` aplicadas e o seed de demonstração (seis conversas `demo-seed`).
- Funções na região `gru1` (São Paulo), fixada em `vercel.json`, ao lado do banco em `sa-east-1`: cada consulta ao Postgres fica dentro da mesma região.
