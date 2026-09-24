import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit/audit"
import { verifyAuditIntegrity } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Confere se a trilha de auditoria continua íntegra (nenhum registro alterado, apagado no meio ou inserido).
// Mesmo perfil da exportação (coordenador ou acima): a conferência lê a trilha inteira. O resultado — inclusive
// quando encontra problema — também fica registrado na trilha.
// É POST, e não GET, porque TEM EFEITO: grava a própria verificação na trilha (e é uma varredura pesada). Uma navegação
// vinda de outro site carregaria o cookie Lax num GET (disparo à vontade de linhas na auditoria e de carga no banco); como
// POST, cai na proteção contra CSRF do proxy. A verificação NÃO sela nada de ninguém (ver audit-seal.ts).
export async function POST() {
  try {
    const user = await requirePermission("exportar-auditoria")
    const empresa = await getEmpresaAtual()

    const relatorio = await verifyAuditIntegrity({ empresaId: empresa.id })
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
