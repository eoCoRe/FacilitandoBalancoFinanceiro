import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { logAudit } from "@/lib/server/audit"
import { handleRouteError } from "@/lib/server/http"
import { requireNonEmptyString, ValidationError } from "@/lib/server/validation"

// Abre um novo exercício para tabulação — equivalente a `store.addExercicio`. O
// período é texto livre (ex.: "1T2027"), como já é no frontend; a unicidade por
// empresa é garantida aqui em vez de depender do erro de constraint do banco, no
// mesmo estilo de app/api/plano-de-contas (nextCodigo checa antes de criar).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { periodo: rawPeriodo } = body as { periodo: unknown }
    const periodo = requireNonEmptyString(rawPeriodo, "periodo", 50)

    const empresa = await getDefaultEmpresa()

    const existente = await prisma.exercicio.findUnique({
      where: { empresaId_periodo: { empresaId: empresa.id, periodo } },
    })
    if (existente) throw new ValidationError(`Exercício "${periodo}" já existe.`)

    const exercicio = await prisma.exercicio.create({ data: { empresaId: empresa.id, periodo } })

    await logAudit(empresa.id, "Exercício criado", `Novo exercício "${periodo}" aberto para tabulação.`)

    return NextResponse.json(exercicio, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
