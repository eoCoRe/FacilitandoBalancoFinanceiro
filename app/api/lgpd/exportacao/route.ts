import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit/audit"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requirePermission } from "@/lib/server/auth/authz"
import { exportEmpresaData } from "@/lib/server/data/lgpd"

// Direito de acesso e portabilidade (LGPD Art. 18, II e V) — devolve tudo que o sistema
// tem sobre a empresa (protótipo é single-tenant). Só o perfil administrador (permissão "lgpd").
export async function GET() {
  try {
    const admin = await requirePermission("lgpd")
    const empresa = await getDefaultEmpresa()
    const dados = await exportEmpresaData(empresa.id)

    await logAudit(empresa.id, "Exportação de dados solicitada (LGPD)", "Direito de acesso/portabilidade exercido.", admin.email)

    return NextResponse.json(dados)
  } catch (error) {
    return handleRouteError(error)
  }
}
