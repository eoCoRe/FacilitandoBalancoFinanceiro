import "dotenv/config"
import { prisma } from "@/lib/db"
import { purgeExpiredData } from "@/lib/server/retention"

// Rotina de expurgo (LGPD Art. 15/16) — pensada para rodar via agendador externo (cron,
// GitHub Actions scheduled workflow, Vercel Cron, etc.), nunca como rota HTTP: é uma
// operação destrutiva; como script de linha de comando ela não passa pelas rotas de API e, portanto,
// não pode ser acionada por quem não tem acesso ao servidor. Ver README/SECURITY.md para como agendar.
async function main() {
  const resultado = await purgeExpiredData()
  console.log(
    `Expurgo concluído: ${resultado.auditLogsApagados} log(s) de auditoria, ${resultado.extracoesApagadas} extração(ões) e ${resultado.tokensApagados} token(s) vencido(s) apagados.`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
