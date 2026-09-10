import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { exportEmpresaData, requireLgpdToken } from "@/lib/server/lgpd"

// Direito de acesso e portabilidade (LGPD Art. 18, II e V) — devolve tudo que o sistema
// tem sobre a empresa (protótipo é single-tenant). Protegido por token compartilhado (ver
// lib/server/lgpd.ts) até existir autenticação real (RNF02).
export async function GET(request: Request) {
  try {
    requireLgpdToken(request)
    const empresa = await getDefaultEmpresa()
    const dados = await exportEmpresaData(empresa.id)

    await logAudit(empresa.id, "Exportação de dados solicitada (LGPD)", "Direito de acesso/portabilidade exercido.")

    return NextResponse.json(dados)
  } catch (error) {
    return handleRouteError(error)
  }
}
