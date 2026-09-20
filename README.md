# Central de Balanços

Plataforma de análise de balanços para analistas de crédito: cadastro do Plano de Contas,
tabulação do Balanço/DRE por exercício, demonstrações consolidadas, índices financeiros
calculados automaticamente, parecer de crédito (Opinião de Venda) e a tela de **Extração de PDF**,
onde o analista confere os valores lidos de um Balanço/DRE em PDF antes de confirmá-los para a
Tabulação (fluxo *human-in-the-loop*), com histórico de cada extração (o que foi lido, de onde e a que conta foi ligado). Balanço, DRE, DFC, Balancete e Índices exportam em CSV (`Exportar CSV`, na escala escolhida na tela) e o Parecer de Crédito imprime ou salva em PDF (`Exportar parecer`). Hoje a leitura do PDF é feita por um leitor local, no próprio
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
├── auth/                     # login, recuperação/redefinição de senha, menu da conta, 2FA (e-mail e app autenticador)
├── ui/                       # componentes genéricos (botão, tooltip)
└── *.tsx                     # sidebar, cabeçalho de página, histórico de extrações, selo de auditado, avisos
lib/
├── financial-data.ts         # modelo de dados e motor de cálculo (puro, sem estado)
├── permissions.ts            # perfis e permissões (usado no servidor E na tela)
├── store.tsx                 # FinancialDataProvider / useFinancialStore (estado da UI sincronizado com a API)
├── api-client.ts             # fetch das rotas de /api, com erros traduzidos e tratamento de sessão expirada
├── api-mapping.ts            # resposta da API (ids, Decimal) -> modelo das telas (puro, testado)
├── extraction/               # leitor local de PDF (texto -> linhas -> rótulo/valor -> conta do plano)
├── export-csv.ts             # exportações em CSV das demonstrações e índices (puro, roda no navegador)
├── csv.ts                    # montagem do CSV (BOM, separador `;` para o Excel em português, anti-injeção de fórmula)
├── redaction.ts              # anonimização de CNPJ/CPF/razão social (pronta para uma futura chamada a LLM)
├── db.ts                     # cliente Prisma (só as rotas e scripts usam)
└── server/                   # só servidor (nunca importado por componentes):
    ├── auth/                 #   sessão, senha, login, Google, 2FA (e-mail e TOTP), rate-limit, permissões nas rotas
    ├── mail/                 #   envio de e-mail (SMTP) e modelos das mensagens
    ├── audit/                #   trilha de auditoria: gravação, selos de integridade, filtros da listagem
    ├── data/                 #   regras de dados: plano de contas, valores, empresa, usuários, LGPD, retenção
    └── http.ts, log.ts, validation.ts, after-response.ts   # infraestrutura comum das rotas
prisma/
├── schema.prisma             # Empresa, Exercicio, Conta, Valor, Indice, Extracao, ValorExtraido, AuditLog,
│                             #   LgpdErasureLog, Usuario, TokenVerificacao, CodigoRecuperacao, PoliticaSeguranca
├── migrations/               # histórico versionado do banco
└── seed.ts                   # dados de exemplo + primeiro administrador (SEED_ADMIN_*)
scripts/
├── purge-expired-data.ts     # expurgo por retenção (LGPD) — roda via cron externo, não HTTP
├── ensure-admin.ts           # cria/restabelece o administrador sem apagar dados (pnpm admin:ensure)
└── smoke.mjs                 # teste de fumaça (HTTP, sem mocks), usado pelo job "integration" do CI
vitest.setup.ts               # testes de rota: usuário logado padrão (administrador) e getCurrentUser simulado
.github/workflows/            # CI (tipos, lint, testes, build + teste de fumaça com Postgres real) e CodeQL
```

## Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — camadas, modelo de dados, ciclo de uma requisição, login com 2 etapas e onde mexer para cada tarefa (com diagramas).
- [`docs/OPERACAO.md`](docs/OPERACAO.md) — colocar no ar e manter: variáveis, checklist de publicação, backup, troca de segredos, emergências.
- [`SECURITY.md`](SECURITY.md) — o que o sistema protege (e o que não), mapeado ao RNF02/RNF03 e à LGPD.
- [`.env.example`](.env.example) — todas as variáveis de ambiente, comentadas.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | servidor de desenvolvimento |
| `pnpm build` / `pnpm start` | build e execução de produção |
| `pnpm test` / `pnpm test:watch` | testes (Vitest; Prisma simulado, não precisam do banco) |
| `pnpm lint` | ESLint |
| `pnpm smoke` | teste de fumaça contra o app RODANDO (`pnpm build && pnpm start`) e um Postgres real: login, permissões, leitura e escrita por HTTP (`scripts/smoke.mjs`). O CI roda isso em um banco vazio |
| `npx tsc --noEmit` | checagem de tipos (o `next build` também checa; este é o atalho rápido) |
| `pnpm purge:data` | expurgo de AuditLog/Extracao antigos (ver SECURITY.md) |
| `pnpm admin:ensure` | cria/restabelece o administrador (`SEED_ADMIN_*`) **sem apagar dados** — o caminho em produção; o `prisma db seed` é só para desenvolvimento e apaga os dados de negócio |

## Acesso e perfis

Login com e-mail/senha e, opcionalmente, com Google (defina `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `APP_URL`; só entra quem um administrador já cadastrou).
Sessão de 8 h renovada enquanto se usa (teto de 24 h) e botão "Encerrar outras sessões" no menu da conta.
Recuperação de senha ("Esqueci minha senha") e verificação em 2 etapas — por código enviado ao
e-mail ou por **aplicativo autenticador** (TOTP, com códigos de recuperação) —, opcional por usuário,
com opção de o administrador exigir por perfil. Recuperação e código por e-mail precisam de
SMTP (`SMTP_*` no `.env`); sem ele, em desenvolvimento o e-mail aparece no console do
servidor e em produção esses recursos ficam desligados. O aplicativo autenticador não depende de e-mail.
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

A trilha de auditoria é **selada** (cada registro encadeado ao anterior por HMAC) e o botão "Verificar integridade"
da tela Auditoria aponta qualquer registro alterado ou apagado no meio (ver `SECURITY.md` para os limites).
Cada usuário, de qualquer perfil, baixa os próprios dados pessoais em **Privacidade e segurança → Baixar meus dados** (`GET /api/auth/meus-dados`).
