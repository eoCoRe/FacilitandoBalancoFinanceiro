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
│                            #   extracoes, auditoria, health) — cada uma com
│                            #   route.test.ts ao lado
├── layout.tsx / page.tsx
components/
├── screens/                # telas: dashboard, plano-de-contas, tabulacao,
│                            #   demonstracoes, indices, opiniao-de-venda,
│                            #   extracao-ia
└── ui/                     # componentes genéricos (botão, etc.)
lib/
├── financial-data.ts       # modelo de dados e motor de cálculo (puro, sem estado)
├── store.tsx               # FinancialDataProvider / useFinancialStore (estado da UI)
├── db.ts                    # cliente Prisma (usado só pelas rotas de api/)
├── server/                  # validação, auditoria, erro HTTP — compartilhado entre rotas
├── navigation.ts
└── utils.ts
prisma/
├── schema.prisma            # Empresa, Exercicio, Conta, Valor, Indice, Extracao, AuditLog
└── seed.ts                  # espelha os dados de exemplo de lib/financial-data.ts no Postgres
```

## Rodando localmente

A interface funciona sem banco (usa `localStorage`). Para exercitar as rotas de
`app/api/` (ex.: via `curl`/Postman, ou nos testes que batem no banco de verdade):

```bash
pnpm install
cp .env.example .env          # ajuste DATABASE_URL se não usar o compose abaixo
docker compose up -d          # Postgres local
npx prisma migrate dev
npx prisma db seed
pnpm dev
```

Acesse `http://localhost:3000`. `pnpm test` roda a suíte com Prisma mockado —
não precisa do banco no ar.
