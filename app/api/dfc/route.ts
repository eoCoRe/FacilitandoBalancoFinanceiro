import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// DFC é somente leitura e fora do escopo funcional do RFC (ver a nota em
// lib/financial-data.ts sobre createSeedDfc) — todas as linhas, inclusive
// subtotais, já têm valor fixo lançado no seed; nada é calculado aqui.
export async function GET() {
  try {
    await requirePermission("consultar")
    return await buildDfc((await getEmpresaAtual()).id)
  } catch (error) {
    return handleRouteError(error)
  }
}

async function buildDfc(empresaId: number) {
  const contas = await prisma.conta.findMany({
    where: { tipo: "DFC" },
    // Só os valores da empresa em análise: a conta é global, o valor é de um exercício (e o exercício, de uma empresa).
    include: { valores: { where: { exercicio: { empresaId } }, include: { exercicio: true } } },
    orderBy: { id: "asc" },
  })

  const linhas = contas.map((conta) => {
    const valores: Record<string, number> = {}
    for (const v of conta.valores) valores[v.exercicio.periodo] = Number(v.valor)
    return { id: conta.id, codigo: conta.codigo, descricao: conta.descricao, valores }
  })

  return NextResponse.json({ linhas })
}
