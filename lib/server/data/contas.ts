import { prisma } from "@/lib/db"
import type { Account } from "@/lib/financial-data"

// Reconstrói as contas tipo BP no formato `Account` (code/name/values/children) que o
// motor de índices em lib/financial-data.ts espera — mesma fonte de verdade do cálculo
// usada pelo frontend (sumAccount, findAccountByName), sem duplicar a lógica de soma no
// servidor. Formato de árvore próprio de app/api/plano-de-contas/route.ts (ContaNode) não
// é reaproveitado aqui de propósito: são consumidores diferentes com formas diferentes.
export async function buildBpAccountTree(): Promise<Account[]> {
  const contas = await prisma.conta.findMany({
    where: { tipo: "BP" },
    include: { valores: { include: { exercicio: true } } },
    orderBy: { codigo: "asc" },
  })

  const nodeById = new Map<number, Account>()
  for (const conta of contas) {
    const values: Record<string, number> = {}
    for (const v of conta.valores) values[v.exercicio.periodo] = Number(v.valor)
    const node: Account = { code: conta.codigo, name: conta.descricao }
    if (Object.keys(values).length > 0) node.values = values
    nodeById.set(conta.id, node)
  }

  const roots: Account[] = []
  for (const conta of contas) {
    const node = nodeById.get(conta.id)!
    if (conta.contaPaiId === null) {
      roots.push(node)
      continue
    }
    const parent = nodeById.get(conta.contaPaiId)
    if (parent) parent.children = [...(parent.children ?? []), node]
  }

  return roots
}
