import { NextResponse } from "next/server"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { eraseEmpresaData, requireLgpdToken } from "@/lib/server/lgpd"
import { requireNonEmptyString } from "@/lib/server/validation"

// Direito de eliminação (LGPD Art. 18, VI) — irreversível. Protegido por token
// compartilhado (ver lib/server/lgpd.ts) até existir autenticação real (RNF02). Não usa
// logAudit: a empresa (e o AuditLog dela, via cascade) deixa de existir; o comprovante da
// exclusão fica em LgpdErasureLog, que sobrevive de propósito (ver eraseEmpresaData).
export async function DELETE(request: Request) {
  try {
    requireLgpdToken(request)

    const raw = await request.text()
    const body = raw.trim() ? JSON.parse(raw) : {}
    const rawSolicitadoPor = (body as { solicitadoPor?: unknown }).solicitadoPor

    const empresa = await getDefaultEmpresa()
    const resultado = await eraseEmpresaData(
      empresa.id,
      rawSolicitadoPor === undefined ? undefined : requireNonEmptyString(rawSolicitadoPor, "solicitadoPor"),
    )

    return NextResponse.json(resultado)
  } catch (error) {
    return handleRouteError(error)
  }
}
