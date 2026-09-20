import { prisma } from "@/lib/db"
import { sealOwn } from "@/lib/server/audit/audit-seal"
import { describeError, logEvent } from "@/lib/server/log"

// RNF03 (Auditabilidade). `usuario` é o e-mail de quem agiu (o da sessão); "Sistema" fica só
// para o que não tem pessoa por trás (seed, rotinas). Guardamos o texto e não uma FK para
// que a trilha sobreviva mesmo se o cadastro do usuário mudar.
export async function logAudit(empresaId: number, acao: string, detalhe: string, usuario = "Sistema") {
  const row = await prisma.auditLog.create({ data: { empresaId, usuario, acao, detalhe } })
  // Sela o registro novo (integridade, ver audit-seal.ts). Se falhar, o registro JÁ está gravado: este processo tenta de
  // novo na próxima gravação, e, se o processo reiniciar antes, um administrador sela à mão — nunca se perde nem se
  // recusa a ação.
  try {
    await sealOwn(row.id)
  } catch (error) {
    logEvent("warn", "audit.seal.failed", describeError(error))
  }
  return row
}

// Para eventos que acontecem ANTES de haver sessão (login, login recusado): falhar em
// registrar a auditoria não pode impedir nem mascarar o resultado do login.
export async function logAuditSafe(acao: string, detalhe: string, usuario: string) {
  try {
    const empresa = await prisma.empresa.findFirst({ orderBy: { id: "asc" } })
    if (empresa) await logAudit(empresa.id, acao, detalhe, usuario.slice(0, 254))
  } catch (error) {
    // sem empresa cadastrada ou banco indisponível — o login segue o seu curso, mas o evento que NÃO entrou na trilha
    // fica no log estruturado (só nome e código do erro).
    logEvent("warn", "audit.write_failed", { acao, ...describeError(error) })
  }
}
