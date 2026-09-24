import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { computeDre, DRE_LINES, DRE_MEMO_LINE, type DreValues } from "@/lib/financial-data"

// Linhas de DRE (Conta tipo DRE, só as de entrada) + valores lançados, com os
// totalizadores calculados pelo mesmo motor puro do frontend (computeDre) —
// nada de lógica de negócio duplicada entre cliente e servidor.
export async function GET() {
  try {
    await requirePermission("consultar")
    return await buildDre((await getEmpresaAtual()).id)
  } catch (error) {
    return handleRouteError(error)
  }
}

async function buildDre(empresaId: number) {
  const contas = await prisma.conta.findMany({
    where: { tipo: "DRE" },
    // Só os valores da empresa em análise: a conta é global, o valor é de um exercício (e o exercício, de uma empresa).
    include: { valores: { where: { exercicio: { empresaId } }, include: { exercicio: true } } },
    orderBy: { id: "asc" },
  })

  const contaIdByLineId = new Map<string, number>()
  const inputsByPeriodo: Record<string, DreValues> = {}

  for (const conta of contas) {
    contaIdByLineId.set(conta.codigo, conta.id)
    for (const v of conta.valores) {
      const periodo = v.exercicio.periodo
      inputsByPeriodo[periodo] ??= {}
      inputsByPeriodo[periodo][conta.codigo] = Number(v.valor)
    }
  }

  const valoresPorExercicio: Record<string, Record<string, number | undefined>> = {}
  for (const [periodo, inputs] of Object.entries(inputsByPeriodo)) {
    valoresPorExercicio[periodo] = computeDre(inputs)
  }

  const linhas = [...DRE_LINES, { id: DRE_MEMO_LINE.id, name: DRE_MEMO_LINE.name, kind: "input" as const }].map(
    (line) => ({ ...line, contaId: contaIdByLineId.get(line.id) ?? null }),
  )

  return NextResponse.json({ linhas, valoresPorExercicio })
}
