import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Empresas cadastradas (para o seletor de empresa) e qual está escolhida agora. Todo perfil enxerga todas: o sistema
// não tem controle de acesso por empresa (ver SECURITY.md).
export async function GET() {
  try {
    await requirePermission("consultar")
    const [empresas, atual] = await Promise.all([
      prisma.empresa.findMany({ orderBy: { razaoSocial: "asc" }, select: { id: true, cnpj: true, razaoSocial: true, setor: true } }),
      getEmpresaAtual(),
    ])
    return NextResponse.json({ empresas, atualId: atual.id })
  } catch (error) {
    return handleRouteError(error)
  }
}
