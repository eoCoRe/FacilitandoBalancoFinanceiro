import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { computeDre, INDICATORS, makeIndicatorContext, type DreValues } from "@/lib/financial-data"
import { requirePermission } from "@/lib/server/authz"
import { buildBpAccountTree } from "@/lib/server/contas"
import { handleRouteError } from "@/lib/server/http"
import { requirePositiveInt, ValidationError } from "@/lib/server/validation"

// Catálogo de índices (nome/fórmula/unidade) — o cálculo em si continua em
// lib/financial-data.ts (INDICATORS). Com `?exercicioId=`, devolve também o valor de
// cada índice para aquele exercício, montado a partir das mesmas contas/valores que
// alimentam /api/plano-de-contas e /api/dre — nenhuma fórmula é recalculada aqui.
export async function GET(request: Request) {
  try {
    await requirePermission("consultar")
    const indices = await prisma.indice.findMany({ orderBy: { id: "asc" } })

    const exercicioIdParam = new URL(request.url).searchParams.get("exercicioId")
    if (!exercicioIdParam) {
      return NextResponse.json({ indices })
    }

    const exercicioId = requirePositiveInt(Number(exercicioIdParam), "exercicioId")
    const exercicio = await prisma.exercicio.findUnique({ where: { id: exercicioId } })
    if (!exercicio) throw new ValidationError("Exercício não encontrado.")

    const [accounts, dreContas] = await Promise.all([
      buildBpAccountTree(),
      prisma.conta.findMany({
        where: { tipo: "DRE" },
        include: { valores: { include: { exercicio: true } } },
      }),
    ])

    const dreInputs: DreValues = {}
    for (const conta of dreContas) {
      const valor = conta.valores.find((v) => v.exercicio.periodo === exercicio.periodo)
      if (valor) dreInputs[conta.codigo] = Number(valor.valor)
    }

    const dre = computeDre(dreInputs)
    const ctx = makeIndicatorContext(accounts, dre, exercicio.periodo)
    const valores = INDICATORS.map((indicator) => ({ id: indicator.id, valor: indicator.compute(ctx) ?? null }))

    return NextResponse.json({ indices, valores })
  } catch (error) {
    return handleRouteError(error)
  }
}
