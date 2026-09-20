import "dotenv/config"
import { prisma } from "@/lib/db"
import { ensureAdmin } from "@/lib/server/auth/ensure-admin"

// Cria (ou restabelece) o administrador a partir de SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, SEM tocar em mais
// nada. É o comando para o primeiro acesso em produção e para recuperar o acesso de um administrador: o
// `prisma db seed` faz isso também, mas apaga a empresa, o plano de contas, os valores e a auditoria.
async function main() {
  const resultado = await ensureAdmin(prisma)
  if (!resultado) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
