import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/db"

// Compartilhado por /api/valores e /api/extracoes — mesma regra do
// store.updateAccountValue do frontend: valor null/undefined apaga o
// lançamento em vez de gravar um valor vazio.
// `db` permite rodar dentro de uma transação (`prisma.$transaction(async (tx) => ...)`), como faz /api/extracoes.
export async function upsertOrDeleteValor(
  contaId: number,
  exercicioId: number,
  valor: number | null | undefined,
  db: Pick<PrismaClient, "valor"> = prisma,
) {
  if (valor === null || valor === undefined) {
    await db.valor.deleteMany({ where: { contaId, exercicioId } })
    return null
  }
  return db.valor.upsert({
    where: { exercicioId_contaId: { exercicioId, contaId } },
    update: { valor },
    create: { exercicioId, contaId, valor },
  })
}
