import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/auth/authz"
import { EMPRESA_COOKIE, EMPRESA_COOKIE_OPTIONS } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requirePositiveInt, ValidationError } from "@/lib/server/validation"

// Troca a empresa em análise: grava o cookie lido por getEmpresaAtual(). Não muda dado nenhum, então não vai para a
// trilha de auditoria; o que for feito depois, na empresa escolhida, vai para a trilha DELA.
export async function POST(request: Request) {
  try {
    await requirePermission("consultar")
    const body = (await request.json()) as { id?: unknown }
    const id = requirePositiveInt(body.id, "id")
    const empresa = await prisma.empresa.findUnique({ where: { id }, select: { id: true, razaoSocial: true } })
    if (!empresa) throw new ValidationError("Empresa não encontrada.")

    const response = NextResponse.json(empresa)
    response.cookies.set(EMPRESA_COOKIE, String(empresa.id), EMPRESA_COOKIE_OPTIONS)
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
