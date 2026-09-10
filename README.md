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
- A interface (telas) ainda roda em memória + `localStorage`
  (`lib/store.tsx`, dados de exemplo em `lib/financial-data.ts`) e por
  enquanto **não consome** as rotas de API — a integração fica para uma
  fase seguinte

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
├── store.tsx               # FinancialDataProvider / useFinancialStore (estado da UI)
├── db.ts                    # cliente Prisma (usado só pelas rotas de api/)
├── server/                  # validação, auditoria, erro HTTP, retenção, LGPD — compartilhado entre rotas
├── navigation.ts
└── utils.ts
prisma/
├── schema.prisma            # Empresa, Exercicio, Conta, Valor, Indice, Extracao, AuditLog, LgpdErasureLog
└── seed.ts                  # espelha os dados de exemplo de lib/financial-data.ts no Postgres
scripts/
└── purge-expired-data.ts    # expurgo de dados por retenção (LGPD) — roda via cron externo, não HTTP
```

## Rodando localmente

A interface funciona sem banco (usa `localStorage`). Para exercitar as rotas de
`app/api/` (ex.: via `curl`/Postman, ou nos testes que batem no banco de verdade):

```bash
pnpm install
cp .env.example .env          # ajuste DATABASE_URL/LGPD_ADMIN_TOKEN se não usar o compose abaixo
docker compose up -d          # Postgres local
npx prisma migrate dev
npx prisma db seed
pnpm dev
```

Acesse `http://localhost:3000`. `pnpm test` roda a suíte com Prisma mockado —
não precisa do banco no ar.

`GET /api/lgpd/exportacao` e `DELETE /api/lgpd/eliminacao` (direitos do titular —
LGPD Art. 18) exigem o header `x-lgpd-token: <LGPD_ADMIN_TOKEN>`. O expurgo por
retenção (`AUDIT_LOG_RETENTION_DAYS`/`EXTRACAO_RETENTION_DAYS`) roda com
`pnpm purge:data` — ver `SECURITY.md` para detalhes e para o motivo de não ser uma
rota HTTP.
