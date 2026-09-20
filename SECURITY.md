# Segurança e Privacidade

Mapeamento entre o §6 (Segurança e Privacidade) e o RNF02 do RFC do projeto e o que está
de fato implementado neste repositório, para servir de referência na documentação do TCC e
ser atualizado conforme o projeto avança. Datas e decisões abaixo refletem o estado em
19/09/2026.

## Dados coletados e base legal (LGPD)

Como descrito no RFC: demonstrações financeiras das empresas-cliente (CNPJ, razão
social, contas e valores contábeis) e metadados da análise. É majoritariamente dado de
pessoa jurídica, mas pode haver dado pessoal (sócios, avalistas, MEI) — nesse caso a
LGPD se aplica integralmente.

- **Base legal**: proteção ao crédito (LGPD art. 7º, X), podendo se apoiar também em
  execução de contrato e legítimo interesse. Finalidade declarada e limitada à análise de
  crédito.
- **Armazenamento**: Postgres (Docker no desenvolvimento; em produção, um Postgres gerenciado, como o Neon
  citado no RFC, que oferece criptografia em repouso na camada de infraestrutura; nada no schema faz
  criptografia de campo adicional).
- **Retenção/descarte**: `lib/server/retention.ts` + `pnpm purge:data` apagam AuditLog e
  Extracao/ValorExtraido mais antigos que o prazo configurado (e, por higiene, os links de recuperação de senha e códigos de 2 etapas já vencidos) (padrão: 730 e 180 dias —
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
| Segredos fora do código | ✅ | `DATABASE_URL`, `AUTH_SECRET`, `SMTP_PASS`, `GOOGLE_CLIENT_SECRET`, `SEED_ADMIN_PASSWORD` e a futura `LLM_API_KEY` só em `.env` (gitignorado); `.env.example` documenta o formato sem valores reais, e o `AUTH_SECRET` de exemplo é curto de propósito para o app recusar acesso até ser trocado |
| Proteção contra SQL injection | ✅ | Todo acesso a dado passa pelo Prisma Client (queries parametrizadas); nenhuma rota usa `$queryRawUnsafe` ou concatenação de SQL |
| Validação de entrada nas rotas de API | ✅ | `lib/server/validation.ts` — tipo, tamanho de string, faixa numérica e limite de itens em todas as rotas que recebem corpo (plano de contas, valores, extrações, exercícios, empresa, usuários, login, senha, 2FA...); erro de validação vira HTTP 400 com mensagem, nunca um 500 cru |
| Cabeçalhos de segurança | ✅ | `next.config.mjs` (testado em `next.config.test.ts` e no Chrome em modo produção): `Content-Security-Policy` (só o próprio domínio para scripts, conexões, imagens e workers; `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY` (anti-clickjacking), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` (só em produção) e `Cache-Control: no-store` em toda a `/api/*`. Sem `unsafe-eval` em produção |
| Logs estruturados sem dados sensíveis | ✅ | `lib/server/log.ts`: uma linha JSON por evento (login recusado, limite de tentativas, código de 2 etapas bloqueado, redefinição de senha, erro inesperado). **Nunca** registra senha, token, código, segredo, cookie ou hash (campos com esses nomes viram `[oculto]`), mascara e-mail (`a**@dominio.com`) e, nos erros, grava só o nome e o código (a mensagem do Prisma pode trazer valores da consulta). Telas de erro (`app/error.tsx`, `global-error.tsx`, `not-found.tsx`) não mostram a mensagem interna ao usuário, só um código para achar o erro no log. **Não há request-id**: o Next não oferece um de forma simples e a API fica fora do `proxy.ts` |
| Exercício auditado | ✅ | `PATCH /api/exercicios/:id` (permissão `auditar-exercicio`, coordenador ou acima) marca o exercício como auditado; aparece como selo na Tabulação e no subtítulo do Parecer. É **informativo**: não bloqueia a edição dos valores. Só grava e audita quando o estado muda, e recusa exercício de outra empresa |
| Tela de Auditoria e exportação | ✅ | Tela "Auditoria" (todos os perfis) com filtros por usuário, ação, período e texto e paginação por cursor (`GET /api/auditoria`, máx. 200 por página, entradas validadas e parametrizadas). **Exportar CSV** (`GET /api/auditoria/exportar`, até 10 mil linhas) exige coordenador ou acima (permissão `exportar-auditoria`), neutraliza **injeção de fórmula** (células que começam com `=`, `+`, `-`, `@` viram texto; a mesma proteção vale para as exportações de Balanço, DRE, DFC, Balancete e Índices, que rodam no navegador e não passam pelo servidor). Os CSVs usam `;` como separador (o Excel em português abre com vírgula tudo numa coluna só) e a própria exportação é registrada na trilha (quem, quantos registros, filtros) |
| Trilha de auditoria (RNF03) | ✅ | `AuditLog` no schema + `lib/server/audit.ts`, chamado por toda rota que muta dado, gravando o **e-mail real** de quem agiu (sessão), além de login, login recusado e gestão de usuários; `GET /api/auditoria` expõe o histórico |
| Rastreabilidade da extração (RF06) | ✅ (estrutura pronta) | `ValorExtraido.paginaOrigem` / `.confianca` no schema; a tela de revisão mostra e usa esses campos. Hoje eles vêm do leitor local de PDF (`lib/extraction/`, sem LLM): página, confiança do casamento com o Plano de Contas e o **texto original lido no documento** (`rotulo_origem`). TODAS as linhas lidas são gravadas no histórico da extração, inclusive as que ficaram **sem conta** (que não lançam valor); só as mapeadas viram `Valor`. A tela de Extração tem o histórico (`GET /api/extracoes` e `/api/extracoes/:id`, qualquer perfil) com o detalhe de cada item |
| Direito de acesso/portabilidade (LGPD Art. 18, II e V) | ✅ | `GET /api/lgpd/exportacao` — devolve empresa, exercícios, contas/valores, extrações e trilha de auditoria em JSON. Só o perfil administrador (permissão `lgpd`) |
| Direito de eliminação (LGPD Art. 18, VI) | ✅ | `DELETE /api/lgpd/eliminacao` — apaga Empresa e tudo em cascata (Exercicio/Valor/Extracao/ValorExtraido/AuditLog); comprovante gravado em `LgpdErasureLog` (tabela sem relação com Empresa, de propósito — sobrevive à exclusão que documenta). Só o perfil administrador (permissão `lgpd`); o e-mail dele vai para o comprovante |
| Retenção e expurgo (LGPD Art. 15/16) | ✅ | `lib/server/retention.ts` + `pnpm purge:data` — apaga AuditLog/Extracao mais antigos que `AUDIT_LOG_RETENTION_DAYS`/`EXTRACAO_RETENTION_DAYS` (padrão 730/180 dias). Pensado para rodar via agendador externo (cron/GitHub Actions/Vercel Cron), nunca como rota HTTP — é destrutivo e não há autenticação para protegê-lo se exposto pela web |
| Anonimização antes de LLM externo | ✅ (motor pronto, ainda sem chamador) | `lib/redaction.ts` — `redactSensitiveText()` mascara CNPJ/CPF (formatados ou só números) e a razão social. Nada chama esta função ainda porque a extração de hoje roda localmente no navegador, sem enviar o documento a terceiros; é o ponto de chamada já definido para quando RF02 passar a usar um LLM de verdade |
| Autenticação (RNF02) | ✅ | Login com **e-mail e senha** (`/api/auth/login`) e/ou **Google** (OpenID Connect + PKCE, `/api/auth/google`). Sessão em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção, assinada (HS256, `jose`) com `AUTH_SECRET` (falha fechada se ausente/curta), validade de 8 h com **renovação deslizante**: depois de 4 h, o próximo acesso reemite o cookie (quem está usando não é deslogado no meio do expediente), mas há um **teto absoluto de 24 h desde o login** (o momento do login original viaja no token e a renovação o preserva). **Encerrar outras sessões** (menu da conta, `POST /api/auth/sessoes/encerrar-outras`) derruba todas as sessões da conta menos a atual. Limitação: "Sair" só apaga o cookie deste navegador — um token copiado antes continua válido até expirar ou até alguém usar "encerrar outras"/trocar a senha (o servidor não guarda uma lista de sessões). O token só carrega o id: a cada requisição o servidor relê o usuário no banco, então **desativar, rebaixar ou trocar a senha vale na hora** (`lib/server/current-user.ts`, coluna `sessoes_validas_desde`) |
| Senhas | ✅ | `scrypt` do Node (N=2^16, r=8, p=2, sal por senha, comparação em tempo constante), parâmetros gravados no próprio hash; mínimo 10 e máximo 128 caracteres; e-mail inexistente gasta o mesmo tempo que senha errada e devolve a mesma mensagem (não enumera usuários) (`lib/server/password.ts`) |
| Força bruta | ✅ (parcial) | 5 falhas por e-mail (e 20 por IP) em 15 min bloqueiam com 429 (`lib/server/rate-limit.ts`). O mesmo limite (5 erros / 15 min) vale ao conferir a **senha atual** de quem já está logado (trocar senha, desligar o 2FA), para uma sessão roubada não adivinhar a senha; e o teto de códigos de 2 etapas por usuário é zerado quando o login conclui. **Limitação**: contador em memória, por instância — em produção com várias instâncias, trocar por armazenamento compartilhado |
| Autorização por perfil (RNF02) | ✅ | Perfis **analista / coordenador / administrador**, cumulativos (`lib/permissions.ts`). Toda rota de API chama `requirePermission()` no servidor (`lib/server/authz.ts`) e responde 401 (sem login) ou 403 (sem permissão); a tela apenas esconde o que não caberia usar. Um teste (`app/api/authorization.test.ts`) exercita a matriz completa e **falha se uma rota nova for criada sem proteção**. `proxy.ts` faz só a checagem otimista de páginas |
| Gestão de usuários | ✅ | Só administrador (`/api/usuarios`, tela "Usuários"). Não há auto-cadastro; usuário nunca é apagado, só desativado (a auditoria continua apontando para alguém que existiu). O administrador não pode rebaixar/desativar a si mesmo nem remover o último administrador ativo. O hash da senha nunca sai do servidor |
| Recuperação de senha por e-mail | ✅ | "Esqueci minha senha" envia um link de **uso único, válido por 30 min** (`/api/auth/recuperar-senha` → `/api/auth/redefinir-senha`). No banco fica só o hash SHA-256 do segredo do link; um novo pedido invalida o anterior; redefinir **derruba todas as sessões abertas** da conta. A resposta é idêntica exista o e-mail ou não; máx. 3 pedidos por e-mail e 10 por IP em 15 min (e 10 links inválidos por IP). O link é montado com `APP_URL`, nunca com o cabeçalho `Host` (evita link envenenado): em produção, sem `APP_URL` o recurso responde 503. O token e o e-mail são criados/enviados depois da resposta, então nem o corpo nem o tempo dela revelam se a conta existe. Se a gravação da nova senha falhar, o link é devolvido. Senha fraca é recusada **antes** de gastar o link |
| Verificação em 2 etapas (2FA) por e-mail | ✅ | Código de 6 dígitos, **10 min, uso único, 5 tentativas** (reservadas de forma atômica no banco, então chutes em paralelo não passam do limite). No banco fica só o **HMAC** do código com `AUTH_SECRET` (6 dígitos com hash simples seriam quebrados em segundos). Acertar a senha **não cria sessão**: só um cookie temporário assinado (`cb_2fa`, `SameSite=Strict`), e a sessão nasce ao confirmar o código; o usuário do 2º passo vem do cookie, não do corpo. Limite de 5 desafios por usuário em 15 min (quem sabe a senha não pode pedir códigos sem fim); ligar o 2FA aceita no máximo 3 códigos em 15 min. **Falha fechado**: se o e-mail não puder ser enviado o login não conclui — nunca se pula o 2º fator |
| Ligar/desligar e exigir o 2FA | ✅ | O usuário liga pelo menu da conta ("Privacidade e segurança") (só liga depois de digitar o código recebido, para ninguém se trancar com um e-mail que não recebe) e desliga com a senha. O administrador pode **exigir por perfil** (tela Usuários) — e isso é recusado se o SMTP não estiver configurado —, e pode desligar o 2FA de quem perdeu o acesso ao e-mail. Perfil obrigado não consegue desligar o único fator que tem (com o app ligado, pode desligar o e-mail, e vice-versa) |

**Perfis e permissões**

| Permissão | Analista | Coordenador | Administrador |
|---|:-:|:-:|:-:|
| Consultar (empresa, contas, DRE, DFC, índices, auditoria) | ✅ | ✅ | ✅ |
| Lançar valores, abrir exercícios, confirmar extração | ✅ | ✅ | ✅ |
| Gerir Plano de Contas; alterar razão social/setor | ❌ | ✅ | ✅ |
| Exportar a trilha de auditoria em CSV | ❌ | ✅ | ✅ |
| Marcar/desmarcar um exercício como auditado | ❌ | ✅ | ✅ |
| Gerir usuários; exportar/eliminar dados (LGPD) | ❌ | ❌ | ✅ |

**Login com Google** (implementado, ainda não ativado): só entra quem já foi cadastrado por um administrador (o e-mail precisa estar verificado pelo Google e o `state`, o PKCE e o `nonce` são conferidos). Exige `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` e `APP_URL`; sem eles o botão não aparece. Os passos do fluxo têm testes unitários e de rota com o Google simulado; **o fluxo completo contra o Google de verdade depende de credenciais e ainda não foi exercitado**.

## O que ainda não está implementado (e por quê)

| Controle (RFC) | Status | Motivo |
|---|---|---|
| Controle de acesso a nível de objeto ("analista não vê dados fora do seu escopo") | ❌ | Fora desta etapa por decisão: o sistema continua com **uma empresa** e o Plano de Contas é global. Fazer isso exige vincular usuário↔empresa, um seletor de empresa e tornar o Plano de Contas por empresa (mudança de modelo). Hoje todo usuário autenticado enxerga a mesma empresa, limitado apenas pelo perfil |
| 2FA por app autenticador (TOTP, RFC 6238) | ✅ | Google Authenticator, Authy, 1Password etc. Implementação própria com `node:crypto` (`lib/server/totp.ts`, conferida com os vetores oficiais da RFC 6238; sem dependência nova). **Ligar**: exige a senha, mostra a chave (e o link `otpauth://`) uma só vez e só passa a valer depois de digitar um código do app. **A chave fica cifrada no banco** (AES-256-GCM, chave derivada de `AUTH_SECRET`) — precisa ser recuperável, então não dá para guardar só hash; um vazamento só do banco não entrega as chaves. Aceita ±1 passo (30 s) de relógio; **cada passo só vale uma vez** (`totp_ultimo_passo`, atualizado de forma atômica), então um código espiado não é reaproveitado. Erros: 5 a cada 15 min por usuário (reentrar com a senha não zera); depois disso, 429 e registro na auditoria. Com o app ligado é ele que o login pede — **o código por e-mail deixa de ser aceito e o reenvio é recusado** (senão seria uma porta dos fundos para quem só sabe a senha). Funciona sem SMTP |
| Códigos de recuperação do TOTP | ✅ | 8 códigos (`XXXXX-XXXXX`, 50 bits, sem caracteres ambíguos), mostrados **uma única vez** ao ligar; uso único, guardados só como HMAC amarrado ao usuário. Gerar novos exige a senha e invalida todos os antigos. Cada uso vai para a auditoria com quantos restam. Desligar o app apaga a chave e os códigos. O administrador pode desligar o 2FA (e-mail **e** app) de quem perdeu o celular |
| Sem QR Code ao cadastrar o app | ❌ | A chave é mostrada em texto (e como link `otpauth://` para abrir no celular); não há QR Code porque isso exigiria uma biblioteca nova. No computador, digite a chave no app |
| Login com Google não passa pelo código de e-mail | ❌ | O login com Google confia na verificação em 2 etapas do próprio Google e **não exige** o código adicional por e-mail, mesmo para perfis com 2FA obrigatório. (O Google está implementado, mas ainda não ativado por falta de credenciais.) |
| Se o SMTP cair com 2FA exigido, ninguém entra | ❌ | É o efeito de falhar fechado. Saída de emergência: restabelecer o SMTP, ou desligar a exigência direto no banco (`DELETE FROM politica_seguranca;`) e `UPDATE usuario SET dois_fatores_ativo = false, totp_ativo = false, totp_segredo = NULL;`. Exigir o 2FA de todos os administradores aumenta o risco de trancar a própria administração |
| Dados pessoais dos usuários (nome, e-mail) no fluxo LGPD | ⚠️ acesso ✅, eliminação ❌ | **Acesso**: cada pessoa baixa os próprios dados em "Privacidade e segurança → Baixar meus dados" (`GET /api/auth/meus-dados`, qualquer perfil, só os dados da sessão; sem hash de senha, id do Google nem controle de sessões; o download fica na trilha). **Eliminação**: `/api/lgpd/*` trata os dados da EMPRESA-cliente; usuários são desativados, não apagados (a trilha de auditoria referencia o e-mail) — a eliminação do cadastro depende de decisão do controlador |
| DPA / contrato de retenção zero com provedor de LLM | ❌ | Depende de qual provedor for escolhido quando a extração real for implementada — decisão de negócio, não de código |
| Avisos residuais em dependências (`pnpm audit`) | ❌ | Depois de atualizar o Next para a 16.3.5 (que corrigiu 2 avisos CRÍTICOS de execução remota na 16.3.0) e mover o `shadcn` (ferramenta de CLI) para `devDependencies`, sobram 15 avisos nas dependências de execução, todos vindos do CLI do Prisma (`prisma` → Studio, servidor de desenvolvimento, `mysql2`: nada disso roda no app, que usa `@prisma/adapter-pg`) ou de ferramentas de build do Next. Só se resolvem com uma atualização do Prisma; rodar `pnpm audit` antes de cada entrega |
| CSP estrita com nonces (sem `'unsafe-inline'` em scripts) | ❌ | O Next injeta scripts inline para hidratar a página; sem nonces por requisição (que exigiriam renderização dinâmica de todas as páginas) a CSP precisa de `'unsafe-inline'` em `script-src`. Ela ainda bloqueia carregar script de outro domínio, iframes, objetos e envio de dados para fora |
| Criptografia de campo para dado sensível em repouso | ❌ | Hoje depende só da criptografia em repouso do provedor gerenciado de Postgres; não há criptografia adicional a nível de coluna |
| HTTPS/TLS obrigatório | N/A neste estágio | Responsabilidade da camada de hospedagem (Vercel ou similar) no deploy, não do código da aplicação em si |
| Prevenção a prompt injection embutida no PDF | ❌ | Só é um risco real quando existir uma chamada de LLM de verdade recebendo texto extraído do documento; hoje não há prompt nenhum sendo montado |
| Prazo de retenção efetivamente decidido | ❌ (mecanismo pronto) | `lib/server/retention.ts` já expurga por prazo configurável, mas o número de dias em si (730/180, atuais defaults) ainda não foi validado como política oficial do negócio |
| Agendamento automático do expurgo | ❌ | `pnpm purge:data` existe e funciona, mas ainda não está registrado em nenhum cron/scheduler — hoje é rodado manualmente |

## Nota sobre o stack de LLM

O RFC (§5.4/§5.5) especifica consumo de uma **API de LLM externa** (não um modelo
próprio self-hosted) com saída estruturada, DPA de retenção zero e anonimização antes do
envio. Isso diverge do que consta em `diagramas_modelo_proprio.md` (que descreve um
modelo fine-tuned self-hosted) — os dois documentos do repositório não estão alinhados
entre si; até essa divergência ser resolvida, os itens de segurança específicos de "envio a
LLM externo" acima seguem a versão do RFC.
