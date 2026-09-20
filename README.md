# Central de Balanços

Frontend da Central de Balanços: cadastro do Plano de Contas, tabulação do
Balanço/DRE por exercício, demonstrações consolidadas, índices financeiros
calculados automaticamente, parecer de crédito (Opinião de Venda) e a tela de
revisão da extração por IA (Extração IA) — onde o analista confere os valores
que o LLM extraiu de um Balanço/DRE em PDF antes de confirmá-los para a
Tabulação (fluxo *human-in-the-loop*).

## Stack

- [Next.js](https://nextjs.org/) (App Router) + React 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) v4
- Backend: rotas de API do próprio Next.js (`app/api/`) + Prisma + Postgres
- A interface lê e grava tudo no Postgres pelas rotas de API
  (`lib/store.tsx` → `lib/api-client.ts`); não há dados em `localStorage` nem
  dados de exemplo no navegador. O banco é populado por `prisma/seed.ts`

## Estrutura

```
app/
├── api/                     # backend: rotas do App Router (empresa, exercicios,
│                            #   plano-de-contas, valores, dre, dfc, indices,
│                            #   extracoes, auditoria, health, lgpd/exportacao,
│                            #   lgpd/eliminacao) — cada uma com route.test.ts ao lado
├── layout.tsx / page.tsx
components/
├── screens/                # telas: dashboard, plano-de-contas, tabulacao,
│                            #   demonstracoes, indices, opiniao-de-venda,
│                            #   extracao-ia
└── ui/                     # componentes genéricos (botão, etc.)
lib/
├── financial-data.ts       # modelo de dados e motor de cálculo (puro, sem estado)
├── redaction.ts            # anonimização de CNPJ/CPF/razão social (pronto para RF02)
├── store.tsx               # FinancialDataProvider / useFinancialStore (estado da UI, sincronizado com a API)
├── api-client.ts            # fetch das rotas de /api com erros já traduzidos para o usuário
├── api-mapping.ts           # resposta da API (ids, Decimal) → modelo que as telas consomem (puro, testado)
├── db.ts                    # cliente Prisma (usado só pelas rotas de api/)
├── server/                  # validação, auditoria, erro HTTP, retenção, LGPD — compartilhado entre rotas
├── navigation.ts
└── utils.ts
prisma/
├── schema.prisma            # Empresa, Exercicio, Conta, Valor, Indice, Extracao, AuditLog, LgpdErasureLog
└── seed.ts                  # popula o Postgres com os dados de exemplo de lib/financial-data.ts
scripts/
└── purge-expired-data.ts    # expurgo de dados por retenção (LGPD) — roda via cron externo, não HTTP
```

## Acesso e perfis

Login com e-mail/senha e, opcionalmente, com Google (defina `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `APP_URL`; só entra quem um administrador já cadastrou).
Recuperação de senha ("Esqueci minha senha") e verificação em 2 etapas por código enviado ao
e-mail — opcional por usuário, com opção de o administrador exigir por perfil. Precisam de
SMTP (`SMTP_*` no `.env`); sem ele, em desenvolvimento o e-mail aparece no console do
servidor e em produção esses recursos ficam desligados.
Três perfis, cumulativos: **analista** (consulta e lança valores/extrações), **coordenador**
(+ Plano de Contas e cadastro da empresa) e **administrador** (+ usuários e LGPD). A regra
está em `lib/permissions.ts` e é imposta no servidor em toda rota de `app/api/`; detalhes e
limitações em `SECURITY.md`.

## Rodando localmente

A interface **precisa do banco no ar**: sem Postgres (ou sem seed) a tela inicial
mostra "Não foi possível carregar os dados".

```bash
cp .env.example .env          # ANTES do install (o postinstall roda `prisma generate`, que lê o .env)
# edite o .env: gere AUTH_SECRET (`openssl rand -hex 32`) e defina SEED_ADMIN_PASSWORD
pnpm install
docker compose up -d          # Postgres local
npx prisma migrate deploy   # aplica as migrações (use `migrate dev` ao alterar o schema)
npx prisma db seed
pnpm dev
```

Acesse `http://localhost:3000` e entre com `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (o `db seed` cria esse administrador; troque a senha em "Senha", no rodapé da barra lateral). Depois, crie os demais acessos em **Usuários** (só administrador). `pnpm test` roda a suíte com Prisma mockado —
não precisa do banco no ar.

`GET /api/lgpd/exportacao` e `DELETE /api/lgpd/eliminacao` (direitos do titular —
LGPD Art. 18) exigem sessão de **administrador**. O expurgo por
retenção (`AUDIT_LOG_RETENTION_DAYS`/`EXTRACAO_RETENTION_DAYS`) roda com
`pnpm purge:data` — ver `SECURITY.md` para detalhes e para o motivo de não ser uma
rota HTTP.
