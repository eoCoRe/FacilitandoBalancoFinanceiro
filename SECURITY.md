# Segurança e Privacidade

Mapeamento entre o §6 (Segurança e Privacidade) e o RNF02 do RFC do projeto e o que está
de fato implementado em `apps/web`, para servir de referência na documentação do TCC e
ser atualizado conforme o projeto avança. Datas e decisões abaixo refletem o estado em
10/09/2026.

## Dados coletados e base legal (LGPD)

Como descrito no RFC: demonstrações financeiras das empresas-cliente (CNPJ, razão
social, contas e valores contábeis) e metadados da análise. É majoritariamente dado de
pessoa jurídica, mas pode haver dado pessoal (sócios, avalistas, MEI) — nesse caso a
LGPD se aplica integralmente.

- **Base legal**: proteção ao crédito (LGPD art. 7º, X), podendo se apoiar também em
  execução de contrato e legítimo interesse. Finalidade declarada e limitada à análise de
  crédito.
- **Armazenamento**: Postgres (hoje um provedor gerenciado — Neon — que oferece
  criptografia em repouso por padrão na camada de infraestrutura; nada no schema faz
  criptografia de campo adicional).
- **Retenção/descarte**: `lib/server/retention.ts` + `pnpm purge:data` apagam AuditLog e
  Extracao/ValorExtraido mais antigos que o prazo configurado (padrão: 730 e 180 dias —
  ver detalhe na tabela abaixo). Prazo em si ainda é decisão de negócio pendente de
  confirmação; o mecanismo já está pronto.
- **Direitos do titular** (confirmação, acesso, correção, eliminação): `GET
  /api/lgpd/exportacao` (acesso/portabilidade) e `DELETE /api/lgpd/eliminacao`
  (eliminação) — ver detalhe na tabela abaixo. Correção continua manual (equivalente a
  `PATCH /api/empresa` + `PATCH /api/plano-de-contas/:id`, já existentes, mas sem um
  fluxo de solicitação formal em torno deles).

## O que está implementado

| Controle (RFC) | Status | Onde |
|---|---|---|
| Validação de upload (tipo/tamanho) | ✅ | `lib/upload-validation.ts` — rejeita arquivo vazio, >20 MB, ou fora de PDF/PNG/JPG, com mensagem clara (cobre o fluxo alternativo "Formato não suportado" do §3.2) |
| Segredos fora do código | ✅ | `DATABASE_URL` e futura `LLM_API_KEY` só em `.env` (gitignored); `.env.example` documenta o formato sem valores reais |
| Proteção contra SQL injection | ✅ | Todo acesso a dado passa pelo Prisma Client (queries parametrizadas); nenhuma rota usa `$queryRawUnsafe` ou concatenação de SQL |
| Validação de entrada nas rotas de API | ✅ | `lib/server/validation.ts` — tipo, tamanho de string, faixa numérica e limite de itens em `/api/plano-de-contas`, `/api/valores` e `/api/extracoes`; erro de validação vira HTTP 400 com mensagem, nunca um 500 cru |
| Trilha de auditoria (RNF03) | ✅ (parcial) | `AuditLog` no schema + `lib/server/audit.ts`, chamado por toda rota que muta dado (criar conta, lançar/remover valor, confirmar extração); `GET /api/auditoria` expõe o histórico |
| Rastreabilidade da extração (RF06) | ✅ (estrutura pronta) | `ValorExtraido.paginaOrigem` / `.confianca` no schema; a tela de revisão já mostra e usa esses campos — falta a extração real alimentá-los com dados de um LLM de verdade |
| Direito de acesso/portabilidade (LGPD Art. 18, II e V) | ✅ | `GET /api/lgpd/exportacao` — devolve empresa, exercícios, contas/valores, extrações e trilha de auditoria em JSON. Protegido por `LGPD_ADMIN_TOKEN` (ver nota abaixo) |
| Direito de eliminação (LGPD Art. 18, VI) | ✅ | `DELETE /api/lgpd/eliminacao` — apaga Empresa e tudo em cascata (Exercicio/Valor/Extracao/ValorExtraido/AuditLog); comprovante gravado em `LgpdErasureLog` (tabela sem relação com Empresa, de propósito — sobrevive à exclusão que documenta). Protegido por `LGPD_ADMIN_TOKEN` |
| Retenção e expurgo (LGPD Art. 15/16) | ✅ | `lib/server/retention.ts` + `pnpm purge:data` — apaga AuditLog/Extracao mais antigos que `AUDIT_LOG_RETENTION_DAYS`/`EXTRACAO_RETENTION_DAYS` (padrão 730/180 dias). Pensado para rodar via agendador externo (cron/GitHub Actions/Vercel Cron), nunca como rota HTTP — é destrutivo e não há autenticação para protegê-lo se exposto pela web |
| Anonimização antes de LLM externo | ✅ (motor pronto, ainda sem chamador) | `lib/redaction.ts` — `redactSensitiveText()` mascara CNPJ/CPF (formatados ou só números) e a razão social. Nada chama esta função ainda porque a extração de hoje é mock; é o ponto de chamada já definido para quando RF02 passar a usar um LLM de verdade |

## O que ainda não está implementado (e por quê)

| Controle (RFC) | Status | Motivo |
|---|---|---|
| Autenticação e autorização por perfil (analista/coordenador/administrador) | ❌ | Decisão explícita do usuário: login fica para uma fase posterior. Efeito colateral conhecido: `AuditLog.usuario` fica fixo em `"Sistema"` (backend) ou o nome hardcoded do usuário de demonstração (frontend) em vez do usuário autenticado real. `/api/lgpd/*` usa um token compartilhado (`LGPD_ADMIN_TOKEN`) como paliativo só para essas duas rotas — não é controle de acesso por perfil, é um mínimo até existir login de verdade |
| Controle de acesso a nível de objeto ("analista não vê dados fora do seu escopo") | ❌ | Depende de autenticação (acima); hoje o sistema é single-tenant/single-usuário por design de protótipo |
| DPA / contrato de retenção zero com provedor de LLM | ❌ | Depende de qual provedor for escolhido quando a extração real for implementada — decisão de negócio, não de código |
| Criptografia de campo para dado sensível em repouso | ❌ | Hoje depende só da criptografia em repouso do provedor gerenciado de Postgres; não há criptografia adicional a nível de coluna |
| HTTPS/TLS obrigatório | N/A neste estágio | Responsabilidade da camada de hospedagem (Vercel ou similar) no deploy, não do código da aplicação em si |
| Prevenção a prompt injection embutida no PDF | ❌ | Só é um risco real quando existir uma chamada de LLM de verdade recebendo texto extraído do documento; hoje não há prompt nenhum sendo montado |
| Prazo de retenção efetivamente decidido | ❌ (mecanismo pronto) | `lib/server/retention.ts` já expurga por prazo configurável, mas o número de dias em si (730/180, atuais defaults) ainda não foi validado como política oficial do negócio |
| Agendamento automático do expurgo | ❌ | `pnpm purge:data` existe e funciona, mas ainda não está registrado em nenhum cron/scheduler — hoje é rodado manualmente |

### Limitação conhecida: migração pendente do `LgpdErasureLog`

O modelo `LgpdErasureLog` (comprovante do direito de eliminação) foi adicionado a
`prisma/schema.prisma`, mas a migração não foi gerada/aplicada nesta máquina (sem Postgres
disponível no ambiente onde o código foi escrito). Antes de usar `/api/lgpd/eliminacao`
contra um banco real, é preciso rodar:

```bash
npx prisma migrate dev --name add_lgpd_erasure_log
```

## Nota sobre o stack de LLM

O RFC (§5.4/§5.5) especifica consumo de uma **API de LLM externa** (não um modelo
próprio self-hosted) com saída estruturada, DPA de retenção zero e anonimização antes do
envio. Isso diverge do que consta em `diagramas_modelo_proprio.md` (que descreve um
modelo fine-tuned self-hosted) — os dois documentos do repositório não estão alinhados
entre si; até essa divergência ser resolvida, os itens de segurança específicos de "envio a
LLM externo" acima seguem a versão do RFC.
