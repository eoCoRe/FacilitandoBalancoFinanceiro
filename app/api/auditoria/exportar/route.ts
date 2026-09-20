import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { AUDIT_EXPORT_MAX, parseAuditQuery } from "@/lib/server/audit/auditoria"
import { requirePermission } from "@/lib/server/auth/authz"
import { toCsv } from "@/lib/csv"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Exporta a trilha de auditoria em CSV (mesmos filtros da listagem; até 10 mil linhas). Só coordenador ou
// acima: a trilha inteira tem e-mails e ações de todos, mais sensível do que ver a lista na tela. A própria
// exportação é registrada na trilha (quem baixou, quantos registros, com quais filtros).
export async function GET(request: Request) {
  try {
    const user = await requirePermission("exportar-auditoria")
    const empresa = await getDefaultEmpresa()

    const params = new URL(request.url).searchParams
    params.delete("cursor") // exportar é sempre "tudo o que bate com os filtros", não uma página
    params.delete("limite")
    const { where, resumo } = parseAuditQuery(params, empresa.id)

    const logs = await prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: AUDIT_EXPORT_MAX })
    const csv = toCsv(
      ["Data/hora (UTC)", "Usuário", "Ação", "Detalhe"],
      logs.map((l) => [l.criadoEm.toISOString(), l.usuario, l.acao, l.detalhe]),
    )

    const truncado = logs.length === AUDIT_EXPORT_MAX ? ` (limitado a ${AUDIT_EXPORT_MAX})` : ""
    await logAudit(empresa.id, "Auditoria exportada", `${logs.length} registro(s)${truncado}; ${resumo}.`, user.email)

    const dia = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditoria-${dia}.csv"`,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
