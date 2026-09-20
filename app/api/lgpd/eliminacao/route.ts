import { NextResponse } from "next/server"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requirePermission } from "@/lib/server/authz"
import { eraseEmpresaData } from "@/lib/server/lgpd"
import { requireNonEmptyString } from "@/lib/server/validation"

// Direito de eliminação (LGPD Art. 18, VI) — irreversível. Só o perfil administrador
// (permissão "lgpd"), e o e-mail dele fica no comprovante. Não usa
// logAudit: a empresa (e o AuditLog dela, via cascade) deixa de existir; o comprovante da
// exclusão fica em LgpdErasureLog, que sobrevive de propósito (ver eraseEmpresaData).
export async function DELETE(request: Request) {
  try {
    const admin = await requirePermission("lgpd")

    const raw = await request.text()
    const body = raw.trim() ? JSON.parse(raw) : {}
    // `solicitadoPor` = quem pediu a eliminação (o titular, p. ex.); o administrador que
    // executou fica registrado junto, vindo da sessão.
    const rawSolicitadoPor = (body as { solicitadoPor?: unknown }).solicitadoPor
    const solicitadoPor =
      rawSolicitadoPor === undefined ? undefined : requireNonEmptyString(rawSolicitadoPor, "solicitadoPor")

    const empresa = await getDefaultEmpresa()
    const resultado = await eraseEmpresaData(
      empresa.id,
      solicitadoPor ? `${solicitadoPor} (executado por ${admin.email})` : admin.email,
    )

    return NextResponse.json(resultado)
  } catch (error) {
    return handleRouteError(error)
  }
}
