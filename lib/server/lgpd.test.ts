import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findUnique: vi.fn(), delete: vi.fn() },
    exercicio: { count: vi.fn() },
    valor: { count: vi.fn() },
    extracao: { count: vi.fn() },
    auditLog: { count: vi.fn() },
    lgpdErasureLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { eraseEmpresaData, exportEmpresaData } from "./lgpd"
import { ValidationError } from "./validation"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("exportEmpresaData", () => {
  it("rejeita quando a empresa não existe", async () => {
    prisma.empresa.findUnique.mockResolvedValue(null)
    await expect(exportEmpresaData(999)).rejects.toThrow(ValidationError)
  })

  it("devolve a empresa com exercícios, valores, extrações e trilha de auditoria aninhados", async () => {
    const empresaCompleta = { id: 1, cnpj: "12.345.678/0001-90", exercicios: [], auditLogs: [] }
    prisma.empresa.findUnique.mockResolvedValue(empresaCompleta)

    const resultado = await exportEmpresaData(1)

    expect(resultado).toBe(empresaCompleta)
    expect(prisma.empresa.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        include: expect.objectContaining({
          exercicios: expect.objectContaining({
            include: expect.objectContaining({
              valores: expect.anything(),
              extracoes: expect.anything(),
            }),
          }),
          auditLogs: true,
        }),
      }),
    )
  })
})

describe("eraseEmpresaData", () => {
  it("rejeita quando a empresa não existe, sem abrir transação", async () => {
    prisma.empresa.findUnique.mockResolvedValue(null)
    await expect(eraseEmpresaData(999)).rejects.toThrow(ValidationError)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("registra o comprovante de exclusão (LgpdErasureLog) e apaga a empresa na mesma transação", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Farmácia Bem-Estar Ltda" })
    prisma.exercicio.count.mockResolvedValue(3)
    prisma.valor.count.mockResolvedValue(40)
    prisma.extracao.count.mockResolvedValue(2)
    prisma.auditLog.count.mockResolvedValue(15)

    const resultado = await eraseEmpresaData(1, "Analista Renata")

    expect(prisma.lgpdErasureLog.create).toHaveBeenCalledWith({
      data: {
        empresaId: 1,
        cnpj: "12.345.678/0001-90",
        razaoSocial: "Farmácia Bem-Estar Ltda",
        registrosApagados: { exercicios: 3, valores: 40, extracoes: 2, auditLogs: 15 },
        solicitadoPor: "Analista Renata",
      },
    })
    expect(prisma.empresa.delete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(resultado.registrosApagados).toEqual({ exercicios: 3, valores: 40, extracoes: 2, auditLogs: 15 })
  })

  it("usa 'Sistema' como solicitante padrão quando não informado", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })
    prisma.exercicio.count.mockResolvedValue(0)
    prisma.valor.count.mockResolvedValue(0)
    prisma.extracao.count.mockResolvedValue(0)
    prisma.auditLog.count.mockResolvedValue(0)

    await eraseEmpresaData(1)

    expect(prisma.lgpdErasureLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ solicitadoPor: "Sistema" }) }),
    )
  })
})
