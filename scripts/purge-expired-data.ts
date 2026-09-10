import "dotenv/config"
import { prisma } from "@/lib/db"
import { purgeExpiredData } from "@/lib/server/retention"

// Rotina de expurgo (LGPD Art. 15/16) — pensada para rodar via agendador externo (cron,
// GitHub Actions scheduled workflow, Vercel Cron, etc.), nunca como rota HTTP: é uma
// operação destrutiva e o sistema ainda não tem autenticação (RNF02) para protegê-la
// adequadamente se exposta pela web. Ver README/SECURITY.md para como agendar.
async function main() {
  const resultado = await purgeExpiredData()
  console.log(
    `Expurgo concluído: ${resultado.auditLogsApagados} log(s) de auditoria e ${resultado.extracoesApagadas} extração(ões) de IA apagados.`,
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
