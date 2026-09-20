# Central de Balanços

Plataforma de análise de balanços para analistas de crédito: cadastro do Plano de Contas,
tabulação do Balanço/DRE por exercício, demonstrações consolidadas, índices financeiros
calculados automaticamente, parecer de crédito (Opinião de Venda) e a tela de **Extração via IA**,
onde o analista confere os valores lidos de um Balanço/DRE em PDF antes de confirmá-los para a
Tabulação (fluxo *human-in-the-loop*), com histórico de cada extração (o que foi lido, de onde e a que conta foi ligado). Hoje a leitura do PDF é feita por um leitor local, no próprio
navegador (`lib/extraction/`), sem LLM e sem enviar o documento a terceiros.

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
├── api/                      # backend (rotas do App Router), cada uma com route.test.ts ao lado:
│   ├── auth/                 #   login, logout, me, senha, recuperar-senha, redefinir-senha, google/, 2fa/
│   ├── usuarios/             #   gestão de usuários (só administrador)
│   ├── seguranca/            #   política de 2FA por perfil (só administrador)
│   ├── empresa/ exercicios/ plano-de-contas/ valores/ dre/ dfc/ indices/ extracoes/
│   ├── auditoria/            #   listagem com filtros/paginação e exportar/ (CSV)
│   ├── lgpd/                 #   exportacao e eliminacao (só administrador)
│   ├── health/               #   verificação de saúde (pública)
│   └── authorization.test.ts #   matriz de permissões: falha se uma rota nova ficar sem proteção
├── login/ esqueci-senha/ redefinir-senha/   # páginas públicas
├── layout.tsx / page.tsx     # o app (o provider de dados mora em page.tsx, não no layout)
proxy.ts                      # checagem otimista de páginas (cookie assinado); a defesa real está em cada rota
components/
├── screens/                  # telas: dashboard, plano-de-contas, tabulacao, demonstracoes, indices,
│                             #   opiniao-de-venda, extracao-ia, auditoria, usuarios
├── ui/                       # componentes genéricos (botão, tooltip)
└── *.tsx                     # sidebar, menu da conta, formulários de login/recuperação, 2FA, avisos
lib/
├── financial-data.ts         # modelo de dados e motor de cálculo (puro, sem estado)
├── permissions.ts            # perfis e permissões (usado no servidor E na tela)
├── store.tsx                 # FinancialDataProvider / useFinancialStore (estado da UI sincronizado com a API)
├── api-client.ts             # fetch das rotas de /api, com erros traduzidos e tratamento de sessão expirada
├── api-mapping.ts            # resposta da API (ids, Decimal) -> modelo das telas (puro, testado)
├── extraction/               # leitor local de PDF (texto -> linhas -> rótulo/valor -> conta do plano)
├── redaction.ts              # anonimização de CNPJ/CPF/razão social (pronta para uma futura chamada a LLM)
├── db.ts                     # cliente Prisma (só as rotas e scripts usam)
└── server/                   # só servidor: sessão, senha, e-mail, 2FA, rate-limit, auditoria, LGPD, validação
prisma/
├── schema.prisma             # Empresa, Exercicio, Conta, Valor, Indice, Extracao, ValorExtraido, AuditLog,
│                             #   LgpdErasureLog, Usuario, TokenVerificacao, PoliticaSeguranca
├── migrations/               # histórico versionado do banco
└── seed.ts                   # dados de exemplo + primeiro administrador (SEED_ADMIN_*)
scripts/
├── purge-expired-data.ts     # expurgo por retenção (LGPD) — roda via cron externo, não HTTP
└── smoke.mjs                 # teste de fumaça (HTTP, sem mocks), usado pelo job "integration" do CI
vitest.setup.ts               # testes de rota: usuário logado padrão (administrador) e getCurrentUser simulado
.github/workflows/            # CI (tipos, lint, testes, build + teste de fumaça com Postgres real) e CodeQL
```

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | servidor de desenvolvimento |
| `pnpm build` / `pnpm start` | build e execução de produção |
| `pnpm test` / `pnpm test:watch` | testes (Vitest; Prisma simulado, não precisam do banco) |
| `pnpm lint` | ESLint |
| `pnpm smoke` | teste de fumaça contra o app RODANDO (`pnpm build && pnpm start`) e um Postgres real: login, permissões, leitura e escrita por HTTP (`scripts/smoke.mjs`). O CI roda isso em um banco vazio |
| `npx tsc --noEmit` | checagem de tipos (o build do Next não a exige) |
| `pnpm purge:data` | expurgo de AuditLog/Extracao antigos (ver SECURITY.md) |

## Acesso e perfis

Login com e-mail/senha e, opcionalmente, com Google (defina `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `APP_URL`; só entra quem um administrador já cadastrou).
Recuperação de senha ("Esqueci minha senha") e verificação em 2 etapas por código enviado ao
e-mail — opcional por usuário, com opção de o administrador exigir por perfil. Precisam de
SMTP (`SMTP_*` no `.env`); sem ele, em desenvolvimento o e-mail aparece no console do
servidor e em produção esses recursos ficam desligados.
Três perfis, cumulativos: **analista** (consulta e lança valores/extrações), **coordenador**
(+ Plano de Contas, cadastro da empresa, marcar exercício como auditado e exportar a auditoria) e **administrador** (+ usuários e LGPD). A regra
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

Acesse `http://localhost:3000` e entre com `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (o `db seed` cria esse administrador; troque a senha em "Senha", no rodapé da barra lateral). Depois, crie os demais acessos em **Usuários** (só administrador).

`GET /api/lgpd/exportacao` e `DELETE /api/lgpd/eliminacao` (direitos do titular —
LGPD Art. 18) exigem sessão de **administrador**. O expurgo por
retenção (`AUDIT_LOG_RETENTION_DAYS`/`EXTRACAO_RETENTION_DAYS`) roda com
`pnpm purge:data` — ver `SECURITY.md` para detalhes e para o motivo de não ser uma
rota HTTP.
