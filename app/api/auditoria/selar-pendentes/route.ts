import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { sealPending } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Selo à mão dos registros que ficaram SEM selo por mais tempo que o prazo (ver audit-seal.ts). É o caminho para se
// recuperar de uma falha passageira de selagem (o servidor sozinho não sela um registro velho: quem tivesse só o
// banco poderia se aproveitar). Só administrador, e é uma decisão: ele atesta que os registros pendentes estão certos.
// A ação — com quantos registros e quais ids — entra na própria trilha, já selada.
export async function POST() {
  try {
    const admin = await requirePermission("selar-auditoria")
    const empresa = await getDefaultEmpresa()

    const pendentes = await prisma.auditLog.findMany({ where: { selo: null }, orderBy: { id: "asc" }, select: { id: true } })
    const selados = await sealPending({ ignoreGrace: true })
    if (pendentes.length > 0) {
      await logAudit(
        empresa.id,
        "Registros pendentes selados manualmente",
        `${selados} registro(s) sem selo (#${pendentes[0].id} a #${pendentes[pendentes.length - 1].id}) foram selados por decisão do administrador.`,
        admin.email,
      )
    }
    return NextResponse.json({ selados })
  } catch (error) {
    return handleRouteError(error)
  }
}
