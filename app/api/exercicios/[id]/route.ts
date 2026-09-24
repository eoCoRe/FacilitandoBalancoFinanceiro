import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requirePositiveInt, ValidationError } from "@/lib/server/validation"

interface RouteParams {
  params: Promise<{ id: string }>
}

// Marca ou desmarca um exercício como AUDITADO (a demonstração foi conferida por auditoria externa). É só
// informação para quem lê o parecer: NÃO bloqueia a edição dos valores. Coordenador ou acima. Só registra na
// trilha quando o valor de fato muda (repetir o mesmo estado é inofensivo e não polui a auditoria).
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await requirePermission("auditar-exercicio")
    const { id } = await params
    const exercicioId = requirePositiveInt(Number(id), "id")

    const body = (await request.json()) as { auditado?: unknown }
    if (typeof body.auditado !== "boolean") throw new ValidationError("auditado deve ser verdadeiro ou falso.")

    const empresa = await getEmpresaAtual()
    const exercicio = await prisma.exercicio.findUnique({ where: { id: exercicioId } })
    // O exercício precisa ser da empresa (hoje só há uma, mas a checagem não deve depender disso).
    if (!exercicio || exercicio.empresaId !== empresa.id) throw new ValidationError("Exercício não encontrado.")

    if (exercicio.auditado === body.auditado) {
      return NextResponse.json({ id: exercicio.id, periodo: exercicio.periodo, auditado: exercicio.auditado })
    }

    const atualizado = await prisma.exercicio.update({ where: { id: exercicioId }, data: { auditado: body.auditado } })
    await logAudit(
      empresa.id,
      body.auditado ? "Exercício marcado como auditado" : "Exercício desmarcado como auditado",
      `${exercicio.periodo}.`,
      user.email,
    )
    return NextResponse.json({ id: atualizado.id, periodo: atualizado.periodo, auditado: atualizado.auditado })
  } catch (error) {
    return handleRouteError(error)
  }
}
