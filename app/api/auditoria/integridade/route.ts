import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit/audit"
import { verifyAuditIntegrity } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Confere se a trilha de auditoria continua íntegra (nenhum registro alterado, apagado no meio ou inserido).
// Mesmo perfil da exportação (coordenador ou acima): a conferência lê a trilha inteira. O resultado — inclusive
// quando encontra problema — também fica registrado na trilha.
// É POST, e não GET, porque TEM EFEITO: sela o que faltar e grava a própria verificação. Uma navegação vinda
// de outro site carregaria o cookie Lax num GET (disparo à vontade de uma varredura pesada e de linhas na
// auditoria); como POST, cai na proteção contra CSRF do proxy.
export async function POST() {
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
