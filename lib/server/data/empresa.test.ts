import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, cookies } = vi.hoisted(() => ({
  prisma: { empresa: { findFirst: vi.fn(), findUnique: vi.fn() } },
  cookies: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("next/headers", () => ({ cookies }))

import { getEmpresaAtual } from "@/lib/server/data/empresa"

const comCookie = (valor: string | undefined) =>
  cookies.mockResolvedValue({ get: (nome: string) => (nome === "cb_empresa" && valor !== undefined ? { value: valor } : undefined) })

beforeEach(() => {
  vi.clearAllMocks()
  comCookie(undefined)
})

describe("getEmpresaAtual", () => {
  it("sem escolha: a primeira empresa cadastrada (ordenada por id)", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90" })
    const empresa = await getEmpresaAtual()
    expect(empresa.id).toBe(1)
    expect(prisma.empresa.findFirst).toHaveBeenCalledWith({ orderBy: { id: "asc" } })
    expect(prisma.empresa.findUnique).not.toHaveBeenCalled()
  })

  it("com a empresa escolhida no cookie: ela", async () => {
    comCookie("7")
    prisma.empresa.findUnique.mockResolvedValue({ id: 7, cnpj: "11.222.333/0001-81" })
    const empresa = await getEmpresaAtual()
    expect(empresa.id).toBe(7)
    expect(prisma.empresa.findUnique).toHaveBeenCalledWith({ where: { id: 7 } })
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled()
  })

  it("empresa escolhida que não existe mais (ex.: eliminada pela LGPD): volta para a primeira", async () => {
    comCookie("7")
    prisma.empresa.findUnique.mockResolvedValue(null)
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
    expect((await getEmpresaAtual()).id).toBe(1)
  })

  it("cookie com lixo é ignorado (não vira consulta)", async () => {
    for (const lixo of ["abc", "-3", "1.5", "0", ""]) {
      comCookie(lixo)
      prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
      expect((await getEmpresaAtual()).id).toBe(1)
    }
    expect(prisma.empresa.findUnique).not.toHaveBeenCalled()
  })

  it("fora de uma requisição (scripts): sem escolha", async () => {
    cookies.mockRejectedValue(new Error("cookies was called outside a request scope"))
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
    expect((await getEmpresaAtual()).id).toBe(1)
  })

  it("lança erro claro quando não há empresa cadastrada (banco não seedado)", async () => {
    prisma.empresa.findFirst.mockResolvedValue(null)
    await expect(getEmpresaAtual()).rejects.toThrow(/Nenhuma empresa cadastrada/)
  })
})
