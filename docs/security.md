# Segurança e privacidade

## Login de demonstração (exceção consciente)

Com `DEMO_AUTH_ENABLED=true`, qualquer e-mail do seed entra com qualquer senha não vazia, como o PRD permite. É **inseguro por definição** e só é aceitável porque todos os dados são fictícios. Com a variável desligada, o login responde "indisponível" em vez de aceitar alguém.

Mesmo no modo demo:

- e-mails desconhecidos não entram e não há cadastro aberto;
- papel e identidade vêm do banco, nunca do cliente;
- tentativas são limitadas por IP e auditadas.

As contas de demonstração ficam listadas na página pública `/privacidade` e no README, com o aviso de que qualquer senha é aceita. É intencional: o repositório e a URL de produção são públicos para avaliação, e não há dado real a proteger. O risco que sobra é custo de IA, limitado pelos controles de [Abuso e custo](#abuso-e-custo) (teto global diário de turnos, limites por funcionário e por sessão) e pelo limite de gasto no console da Anthropic. Com `DEMO_AUTH_ENABLED=false` a lista some da página e o login deixa de aceitar senhas.

### Substituir o login de demonstração

O ponto de troca é `src/app/api/auth/login/route.ts`. Com OIDC (Entra ID, Okta, Google Workspace): redirecionar para o provedor, validar o `id_token` no callback, achar ou provisionar o usuário pelo e-mail corporativo e chamar `createSession`. Sessões, políticas e o resto da aplicação não mudam.

## Sessões

- Token aleatório de 32 bytes; o banco guarda só o SHA-256.
- Cookie `nexo_session`: HttpOnly, SameSite=Lax, Secure em produção, `Path=/`.
- 12 h por padrão; 30 dias com "manter conectado" (cookie persistente apenas nesse caso).
- Toda requisição valida sessão, expiração, revogação e se o usuário está ativo.
- Logout revoga a sessão no servidor.

## Autorização

`src/server/auth/policies.ts` e consultas sempre filtradas pelo dono:

- Funcionário só acessa as próprias conversas, chamados, rascunhos e turnos. Um número de chamado não dá acesso: `findForRequester` filtra pelo solicitante e o resultado de outra pessoa é "não encontrado".
- Analista acessa fila, conversas e chamados porque é o trabalho dele; só o analista que assumiu escreve ou devolve/encerra.
- Ferramentas do agent recebem a identidade pelo `requestContext`; nenhuma aceita id de usuário do modelo.
- Esconder um botão nunca é a proteção: todas as regras valem no servidor.

## Entradas e saídas

- Zod em todas as rotas; corpo ≤ 32 KB; mensagem ≤ 2.000 caracteres (analista: 4.000).
- Mutações exigem `Origin` igual ao host (CSRF), além de SameSite.
- React escapa todo texto; não há `dangerouslySetInnerHTML`.
- Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Erros para o usuário são mensagens em português sem stack trace; detalhes só nos logs com `requestId`.

## LLM

- A chave fica só no servidor (`ANTHROPIC_API_KEY`), nunca em `NEXT_PUBLIC_*`.
- O modelo não executa SQL nem escreve no banco: só chama ferramentas validadas.
- Artigos, descrições de chamados e mensagens antigas são dados; as instruções dizem para ignorar ordens dentro deles, e as regras críticas não dependem do prompt (prioridade, duplicidade, confirmação, autorização, pausa durante atendimento humano).
- O contexto de um funcionário só contém dados dele.
- A interface não expõe raciocínio interno do modelo, só ações e decisões registradas.

## Abuso e custo

| Controle                   | Padrão               | Onde                           |
| -------------------------- | -------------------- | ------------------------------ |
| Turnos por funcionário     | 8/min, 150/dia       | `rate_limits` (Postgres)       |
| Turnos globais             | 1.500/dia            | `LLM_GLOBAL_DAILY_TURNS`       |
| Mensagens por sessão       | 30 (do funcionário)  | mensagens gravadas na conversa |
| Logins por IP              | 20 / 10 min          | `rate_limits`                  |
| Tokens de saída por passo  | 1.200                | `LLM_MAX_OUTPUT_TOKENS`        |
| Passos por turno / timeout | 8 / 45 s             | `turn.ts`                      |
| Um turno por conversa      | índice único parcial | `agent_turns`                  |

Recomendado também: limite de gasto mensal no console da Anthropic e na Vercel.

## Segredos

`.env*` está no `.gitignore` (exceto `.env.example`, só com placeholders). Na Vercel, chaves como variáveis _Sensitive_. Nenhum segredo vai para logs, commits, issues ou PRs.
