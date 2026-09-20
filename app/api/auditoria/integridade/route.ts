import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit/audit"
import { verifyAuditIntegrity } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Confere se a trilha de auditoria continua íntegra (nenhum registro alterado, apagado no meio ou inserido).
// Mesmo perfil da exportação (coordenador ou acima): a conferência lê a trilha inteira. O resultado — inclusive
// quando encontra problema — também fica registrado na trilha.
export async function GET() {
  try {
    const user = await requirePermission("exportar-auditoria")
    const empresa = await getDefaultEmpresa()

    const relatorio = await verifyAuditIntegrity()
    await logAudit(
      empresa.id,
      "Integridade da auditoria verificada",
      relatorio.integra
        ? `Íntegra: ${relatorio.verificados} registro(s) conferidos.`
        : `PROBLEMA no registro #${relatorio.quebra?.id}: ${relatorio.quebra?.motivo}`,
      user.email,
    )
    return NextResponse.json(relatorio)
  } catch (error) {
    return handleRouteError(error)
  }
}
