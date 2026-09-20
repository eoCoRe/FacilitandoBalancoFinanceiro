# Operação — colocar no ar e manter

Guia para quem publica e cuida do sistema. O que o sistema protege e o que ele **não** protege está em
[`SECURITY.md`](../SECURITY.md); como rodar na sua máquina está no [`README.md`](../README.md).

## 1. Variáveis de ambiente

Modelo comentado em [`.env.example`](../.env.example). Nunca commite valores reais.

| Variável | Em produção | Para quê |
|---|---|---|
| `DATABASE_URL` | obrigatória | Postgres. Use um usuário só desta aplicação, com senha própria |
| `AUTH_SECRET` | **obrigatória** (≥ 32 caracteres) | Assina as sessões, cifra as chaves do app autenticador e gera os HMAC dos códigos. Sem ela as páginas e as rotas de API respondem 503 com a causa |
| `APP_URL` | **obrigatória**, com `https` | Base dos links enviados por e-mail e do retorno do Google. Sem ela a recuperação de senha fica desligada |
| `SMTP_HOST`, `SMTP_FROM` (+ `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`) | necessárias para recuperação de senha e código de 2 etapas **por e-mail** | Sem SMTP em produção esses recursos ficam desligados (nunca finge enviar). O app autenticador (TOTP) não depende de e-mail |
| `AUDIT_SEAL_SECRET` | recomendada (≥ 32 caracteres) | Chave dos selos da trilha de auditoria. Sem ela usa `AUTH_SECRET` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opcionais | Ativam "Entrar com Google" (ainda não testado com credenciais reais) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | só ao rodar `pnpm admin:ensure` | Criam (ou restabelecem) o administrador. Troque a senha depois |
| `AUDIT_LOG_RETENTION_DAYS`, `EXTRACAO_RETENTION_DAYS` | opcionais (730 / 180) | Prazos do expurgo (`pnpm purge:data`) |

## 2. Checklist de publicação

1. Gere os segredos: `openssl rand -hex 32` para `AUTH_SECRET` e outro para `AUDIT_SEAL_SECRET`. Guarde-os no cofre do provedor.
2. Configure as variáveis acima, com `APP_URL` em `https`.
3. `npx prisma migrate deploy` (aplica as migrações; **nunca** `migrate dev` nem `db push` em produção).
4. `pnpm admin:ensure` (com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` definidos) cria o primeiro administrador **sem tocar em mais nada**. **Não rode `prisma db seed` em produção**: ele é o carregador de dados de exemplo e APAGA empresa, plano de contas, valores, extrações e a trilha de auditoria (por segurança ele se recusa quando `NODE_ENV=production`, salvo `SEED_CONFIRM_WIPE=sim`).
5. Entre, troque a senha, ligue a verificação em 2 etapas, cadastre a empresa/plano de contas e crie os demais acessos em **Usuários**.
6. Agende o expurgo (`pnpm purge:data`) num cron externo — não é uma rota HTTP de propósito.
7. Se esta instalação **já tinha registros de auditoria antes** da selagem (atualização de uma versão anterior), entre como administrador, abra **Auditoria → Verificar integridade** e use "selar os pendentes" uma vez: o servidor nunca sela histórico sozinho. Instalação nova não precisa disso.
8. Confirme com o teste de fumaça contra o ambiente: `SMOKE_BASE_URL=https://… SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… pnpm smoke` (cria e desativa um usuário de teste; use num ambiente de homologação).

## 3. Rotinas

- **Backup**: `pg_dump` diário do banco, guardado fora do servidor, com teste de restauração de tempos em tempos. O sistema não faz backup por você.
- **Expurgo (LGPD Art. 15/16)**: `pnpm purge:data` apaga trilha de auditoria e extrações vencidas e também links/códigos de 2 etapas expirados. O expurgo apaga os registros **mais antigos** da trilha; a verificação de integridade recomeça do primeiro que sobrou e isso não é tratado como adulteração.
- **Verificar a trilha**: tela **Auditoria → Verificar integridade** (coordenador ou administrador). Faça de vez em quando e depois de qualquer acesso direto ao banco.
- **Atualizações**: Rode `pnpm audit` de tempos em tempos (o CodeQL já roda no CI). Correções de segurança do Next.js entram por versão de patch.

## 4. Trocar segredos

| Segredo | O que acontece | O que fazer depois |
|---|---|---|
| `AUTH_SECRET` | Todas as sessões caem. As chaves do app autenticador e os códigos de recuperação **deixam de valer**. Se não houver `AUDIT_SEAL_SECRET`, a verificação da trilha passa a acusar problema em todos os registros antigos | Avise os usuários; um administrador desliga o 2FA de quem usava o app (tela Usuários) para cadastrar de novo. Por isso defina `AUDIT_SEAL_SECRET` própria |
| `AUDIT_SEAL_SECRET` | A verificação passa a acusar problema em **todos** os registros já selados | Evite trocar. Se for inevitável, registre a data: a trilha anterior deixa de ser verificável |
| `SMTP_PASS`, `GOOGLE_CLIENT_SECRET` | Só o envio de e-mail / login Google | Troque no provedor e na variável |

## 5. Emergências

- **Ninguém consegue entrar, SMTP fora, e o perfil exige 2 etapas por e-mail**: restabeleça o SMTP; ou, no banco: `DELETE FROM politica_seguranca;` e `UPDATE usuario SET dois_fatores_ativo = false, totp_ativo = false, totp_segredo = NULL;`. Depois reative a exigência.
- **Um usuário perdeu o celular do app autenticador**: se ele tem os códigos de recuperação, entra com um deles e gera novos; senão, um administrador desliga o 2FA dele em **Usuários**.
- **Perdeu o acesso de administrador** (senha esquecida sem SMTP, conta desativada): o sistema impede rebaixar/desativar o último, mas se acontecer, defina `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` e rode `pnpm admin:ensure` — recria ou restabelece o administrador (ativo, com a nova senha, **com o 2FA pessoal desligado** — e-mail e app, com os códigos de recuperação —, derrubando as sessões dele) sem apagar nenhum dado. Ligue o 2FA de novo depois de entrar. Atenção: a **política do perfil** (exigir 2 etapas para administradores) NÃO é alterada; se ela estiver ligada e o SMTP fora do ar, o login continua falhando — nesse caso siga também o primeiro item desta lista (`DELETE FROM politica_seguranca;`). O comando avisa quando isso acontece.
- **"A trilha foi adulterada" com "sem selo há mais de 15 minutos"**: costuma ser uma falha passageira de selagem (veja o log `audit.seal.failed`). Se você tem certeza de que ninguém mexeu no banco, um **administrador** usa o botão "selar os pendentes" na própria mensagem; a decisão fica na trilha. Nos outros casos:
- **"A trilha foi adulterada"** (conteúdo alterado ou registro apagado no meio): não apague nada. Anote o id do registro apontado, preserve um `pg_dump` do estado atual e compare com o backup mais recente. Se a causa foi troca de `AUTH_SECRET`/`AUDIT_SEAL_SECRET`, o aviso aparece em todos os registros antigos, não em um só.
- **A empresa foi eliminada (LGPD) e o sistema só mostra erro**: a eliminação apaga a empresa e, sem ela, quase todas as rotas falham; não há tela para cadastrar outra. Em desenvolvimento rode o seed; em produção insira a empresa no banco (`INSERT INTO empresa (cnpj, razao_social) VALUES (...)`) e os exercícios pelo app. Se isso for um fluxo de produto, é uma decisão pendente.
- **Suspeita de sessão roubada**: o usuário usa **Senha** (troca a senha, o que encerra todas as sessões) ou **Encerrar outras sessões**; um administrador pode redefinir a senha em **Usuários**, o que também encerra as sessões.

## 6. Limites conhecidos de infraestrutura

- O limite de tentativas de login e de códigos fica **em memória** de cada instância (com teto de 50 mil chaves). O limite **por IP** só vale atrás de um proxy que sobrescreva `X-Forwarded-For`; sem ele, só o limite por e-mail protege as contas. Com mais de uma instância (ou reinício), o contador zera/divide; para produção com várias instâncias, troque por um armazenamento compartilhado (ex.: Redis) — está descrito no topo de `lib/server/auth/rate-limit.ts`.
- A trilha de auditoria detecta edição e apagamento no meio, mas **não** o apagamento dos registros mais recentes (sem âncora externa).
- O leitor de PDF roda no navegador e não usa IA; a chave `LLM_API_KEY` ainda não é usada.
