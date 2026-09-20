import type { PrismaClient } from "@prisma/client"
import { hashPassword, requireValidPassword } from "./password"

// Confere se SEED_ADMIN_PASSWORD (quando informada junto com o e-mail) passa na política de senha. O seed chama isto
// ANTES de apagar qualquer coisa: uma senha ruim não pode derrubar os dados e só então falhar.
export function assertAdminEnvValid(env: Record<string, string | undefined> = process.env): void {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const senha = env.SEED_ADMIN_PASSWORD
  if (email && senha) requireValidPassword(senha, "SEED_ADMIN_PASSWORD", { email })
}

// Garante que exista um administrador para o primeiro acesso, a partir do ambiente (SEED_ADMIN_EMAIL /
// SEED_ADMIN_PASSWORD) — nenhuma senha padrão fica no código. Não mexe em mais nada: usado pelo seed de
// desenvolvimento e por `pnpm admin:ensure`, o caminho seguro em PRODUÇÃO (o seed apaga os dados de negócio).
//
// Se o e-mail já existe, vira administrador ativo com a senha informada, as sessões abertas dele caem e a
// verificação em 2 etapas dele é DESLIGADA (e-mail e app, com os códigos de recuperação): é a ferramenta de
// recuperação de quem perdeu o acesso, e um administrador que perdeu o celular ficaria trancado do mesmo jeito se
// o 2º fator continuasse valendo. A política do PERFIL (exigir 2 etapas) continua valendo — só avisa. Quem roda isto tem acesso ao servidor/banco, que já podia fazer o mesmo à mão.
// Sem variáveis, só avisa (e diz se falta administrador).
export async function ensureAdmin(
  prisma: Pick<PrismaClient, "usuario" | "codigoRecuperacao" | "politicaSeguranca">,
  env: Record<string, string | undefined> = process.env,
  log: Pick<Console, "log" | "warn"> = console,
): Promise<{ email: string } | null> {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const senha = env.SEED_ADMIN_PASSWORD
  if (!email || !senha) {
    const existing = await prisma.usuario.count({ where: { papel: "ADMINISTRADOR", ativo: true } })
    log.warn(
      existing > 0
        ? "SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não definidos — mantendo os administradores existentes."
        : "ATENÇÃO: nenhum administrador existe e SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não foram definidos — ninguém conseguirá entrar. Veja .env.example.",
    )
    return null
  }
  assertAdminEnvValid(env)
  const senhaHash = await hashPassword(senha)
  const nome = env.SEED_ADMIN_NAME?.trim() || "Administrador"
  const usuario = await prisma.usuario.upsert({
    where: { email },
    update: {
      papel: "ADMINISTRADOR",
      ativo: true,
      senhaHash,
      sessoesValidasDesde: new Date(),
      doisFatoresAtivo: false,
      totpAtivo: false,
      totpSegredo: null,
      totpUltimoPasso: null,
    },
    create: { email, nome, senhaHash, papel: "ADMINISTRADOR" },
  })
  await prisma.codigoRecuperacao.deleteMany({ where: { usuarioId: usuario.id } })
  log.log(`Administrador garantido: ${email}`)
  // A POLÍTICA do perfil não é tocada aqui: se ela exige 2 etapas para administradores e o e-mail (SMTP) não funciona,
  // o login continua falhando (fecha fechado). Quem opera precisa saber disso agora, não depois.
  const politica = await prisma.politicaSeguranca.findUnique({ where: { papel: "ADMINISTRADOR" } })
  if (politica?.doisFatoresObrigatorio) {
    log.warn(
      "ATENÇÃO: a política do perfil ADMINISTRADOR exige verificação em 2 etapas. O 2FA deste usuário foi desligado, mas se o envio de e-mail (SMTP) não estiver funcionando o login ainda vai falhar. Veja docs/OPERACAO.md (Emergências).",
    )
  }
  return { email }
}
