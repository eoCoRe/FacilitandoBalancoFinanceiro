import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { empresa: { findFirst: vi.fn() } },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { getDefaultEmpresa } from "./empresa"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getDefaultEmpresa", () => {
  it("retorna a primeira empresa cadastrada (ordenada por id)", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90" })
    const empresa = await getDefaultEmpresa()
    expect(empresa.id).toBe(1)
    expect(prisma.empresa.findFirst).toHaveBeenCalledWith({ orderBy: { id: "asc" } })
  })

  it("lança erro claro quando não há empresa cadastrada (banco não seedado)", async () => {
    prisma.empresa.findFirst.mockResolvedValue(null)
    await expect(getDefaultEmpresa()).rejects.toThrow(/Nenhuma empresa cadastrada/)
  })
})
