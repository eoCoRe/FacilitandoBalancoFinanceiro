import type { PrismaClient } from "@prisma/client"
import { hashPassword, requireValidPassword } from "./password"

// Garante que exista um administrador para o primeiro acesso, a partir do ambiente (SEED_ADMIN_EMAIL /
// SEED_ADMIN_PASSWORD) — nenhuma senha padrão fica no código. Não mexe em mais nada: usado pelo seed de
// desenvolvimento e por `pnpm admin:ensure`, o caminho seguro em PRODUÇÃO (o seed apaga os dados de negócio).
//
// Se o e-mail já existe, vira administrador ativo com a senha informada e as sessões abertas dele caem. Sem
// variáveis, só avisa (e diz se falta administrador).
export async function ensureAdmin(
  prisma: Pick<PrismaClient, "usuario">,
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
  requireValidPassword(senha, "SEED_ADMIN_PASSWORD", { email })
  const senhaHash = await hashPassword(senha)
  const nome = env.SEED_ADMIN_NAME?.trim() || "Administrador"
  await prisma.usuario.upsert({
    where: { email },
    update: { papel: "ADMINISTRADOR", ativo: true, senhaHash, sessoesValidasDesde: new Date() },
    create: { email, nome, senhaHash, papel: "ADMINISTRADOR" },
  })
  log.log(`Administrador garantido: ${email}`)
  return { email }
}
