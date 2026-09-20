import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    valor: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { upsertOrDeleteValor } from "@/lib/server/data/valores"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("upsertOrDeleteValor", () => {
  it("faz upsert com a chave composta exercicioId_contaId", async () => {
    await upsertOrDeleteValor(5, 2, 1234)
    expect(prisma.valor.upsert).toHaveBeenCalledWith({
      where: { exercicioId_contaId: { exercicioId: 2, contaId: 5 } },
      update: { valor: 1234 },
      create: { exercicioId: 2, contaId: 5, valor: 1234 },
    })
  })

  it("apaga o registro em vez de gravar null ou undefined", async () => {
    await upsertOrDeleteValor(5, 2, null)
    await upsertOrDeleteValor(5, 2, undefined)
    expect(prisma.valor.deleteMany).toHaveBeenCalledTimes(2)
    expect(prisma.valor.deleteMany).toHaveBeenCalledWith({ where: { contaId: 5, exercicioId: 2 } })
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })
})
