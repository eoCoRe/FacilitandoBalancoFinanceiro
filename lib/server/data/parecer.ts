import { prisma } from "@/lib/db"
import { buildSalesOpinion, DFC_LINE_KINDS, type DreValues, type SalesOpinion, type StaticLine } from "@/lib/financial-data"
import { buildBpAccountTree } from "@/lib/server/data/contas"
import { ValidationError } from "@/lib/server/validation"

// Recalcula no SERVIDOR a análise automática do parecer (a mesma função da tela, lib/financial-data.ts) com os dados da
// empresa no banco. O parecer registrado guarda ESTE resultado, não o que a tela mandou: ninguém registra um
// "Favorável" que o sistema não calculou.
export async function calcularParecer(empresaId: number, exercicioId: number, valorSolicitado: number): Promise<{ periodo: string; opiniao: SalesOpinion }> {
  const exercicios = await prisma.exercicio.findMany({ where: { empresaId }, orderBy: { id: "asc" } })
  const i = exercicios.findIndex((e) => e.id === exercicioId)
  if (i < 0) throw new ValidationError("Exercício não encontrado.")
  const periodo = exercicios[i].periodo
  // Período anterior = o exercício aberto antes deste (a mesma ordem da tela).
  const anterior = i > 0 ? exercicios[i - 1].periodo : undefined

  const [accounts, contasDre, contasDfc] = await Promise.all([
    buildBpAccountTree(empresaId),
    prisma.conta.findMany({ where: { tipo: "DRE" }, include: { valores: { where: { exercicio: { empresaId } }, include: { exercicio: true } } } }),
    prisma.conta.findMany({
      where: { tipo: "DFC" },
      include: { valores: { where: { exercicio: { empresaId } }, include: { exercicio: true } } },
      orderBy: { id: "asc" },
    }),
  ])

  const dreByExercicio: Record<string, DreValues> = {}
  for (const conta of contasDre) {
    for (const v of conta.valores) (dreByExercicio[v.exercicio.periodo] ??= {})[conta.codigo] = Number(v.valor)
  }
  const dfc: StaticLine[] = contasDfc.map((conta) => ({
    name: conta.descricao,
    kind: DFC_LINE_KINDS[conta.descricao] ?? "line",
    values: Object.fromEntries(conta.valores.map((v) => [v.exercicio.periodo, Number(v.valor)])),
  }))

  return { periodo, opiniao: buildSalesOpinion(accounts, dreByExercicio, dfc, periodo, anterior, valorSolicitado) }
}
