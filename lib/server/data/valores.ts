import { prisma } from "@/lib/db"

// Compartilhado por /api/valores e /api/extracoes — mesma regra do
// store.updateAccountValue do frontend: valor null/undefined apaga o
// lançamento em vez de gravar um valor vazio.
export async function upsertOrDeleteValor(contaId: number, exercicioId: number, valor: number | null | undefined) {
  if (valor === null || valor === undefined) {
    await prisma.valor.deleteMany({ where: { contaId, exercicioId } })
    return null
  }
  return prisma.valor.upsert({
    where: { exercicioId_contaId: { exercicioId, contaId } },
    update: { valor },
    create: { exercicioId, contaId, valor },
  })
}
