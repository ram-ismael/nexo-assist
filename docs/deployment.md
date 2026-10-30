# Deploy

Um projeto Vercel (Next.js, runtime Node) + um banco Neon. Não há servidor Node separado.

## Uma vez: infraestrutura

1. **Neon**: criar o projeto (região próxima de `gru1`/São Paulo ou `iad1`). Copiar duas strings:
   - _pooled_ (`...-pooler...`) → `DATABASE_URL` na Vercel;
   - direta → para rodar as migrações.

   Alternativa: `vercel integration add neon` cria o banco e injeta `DATABASE_URL` no projeto.

2. **Vercel**: `vercel login`, depois `vercel link` na pasta do projeto (ou importar o repositório pelo painel). Framework: Next.js. Branch de produção: `main`; previews para as demais.
3. **Variáveis** (Production e Preview), marcando as chaves como _Sensitive_:

   | Variável                      | Valor                           |
   | ----------------------------- | ------------------------------- |
   | `DATABASE_URL`                | string _pooled_ do Neon         |
   | `ANTHROPIC_API_KEY`           | chave da Anthropic              |
   | `LLM_MODEL`                   | `anthropic/claude-haiku-5-5`    |
   | `DEMO_AUTH_ENABLED`           | `true` (só com dados fictícios) |
   | `BUSINESS_TIMEZONE`           | `America/Sao_Paulo`             |
   | `AGENT_SESSION_MESSAGE_LIMIT` | `30`                            |
   | `LLM_GLOBAL_DAILY_TURNS`      | `500` (ajuste ao orçamento)     |
   | `DATABASE_POOL_MAX`           | `3`                             |

   Pela CLI, sem deixar a chave no histórico do shell: `vercel env add ANTHROPIC_API_KEY production --sensitive` e cole o valor quando pedido.

4. **Limite de gasto** no console da Anthropic (ex.: US$ 20/mês) além dos limites da aplicação.

## A cada release: migrações

Migrações são um passo explícito, nunca automático no build:

```bash
DATABASE_URL="<string direta do Neon>" pnpm db:migrate
DATABASE_URL="<string direta do Neon>" pnpm db:seed   # idempotente; só insere o que falta
```

As migrações deste projeto são aditivas. Uma migração destrutiva precisaria de revisão manual e backup (branch do Neon) antes.

## Deploy da aplicação

- Merge em `main` → deploy de produção automático pela integração GitHub.
- Ou manual: `vercel deploy --prod`.

## Verificação pós-deploy

```bash
curl -s https://<url>/api/health          # {"status":"ok","database":"ok","llm":"configured"}
```

Depois, no navegador: login como `ana.souza@nexo.com.br` → perguntar o status dos chamados → abrir chamado de VPN e confirmar → pedir analista; em outra janela, `rafael.lima@nexo.com.br` → assumir → responder → devolver. Conferir que nenhum segredo aparece no bundle (`grep -r sk-ant .next/static` deve vir vazio).

## O que falta

Na data desta entrega o deploy **não foi feito**. Neste ambiente não havia:

- sessão da Vercel CLI (`vercel whoami` → _Logged out_);
- projeto Neon ou string de conexão;
- `ANTHROPIC_API_KEY`.

Com esses três itens, os passos acima levam poucos minutos. O código, as migrações, o seed e os testes já estão prontos para isso.
