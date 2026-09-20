import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, mail } = vi.hoisted(() => ({
  prisma: {
    politicaSeguranca: { findMany: vi.fn(), upsert: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mail: { mailAvailable: vi.fn(), sendMail: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/mail", () => ({ mailAvailable: mail.mailAvailable, sendMail: mail.sendMail }))

import { GET, PUT } from "./route"

const put = (body: unknown) => PUT(new Request("http://localhost/api/seguranca", { method: "PUT", body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  mail.mailAvailable.mockReturnValue(true)
})

describe("GET /api/seguranca", () => {
  it("lista os 3 perfis, mesmo os que nunca foram configurados (padrão: não exige)", async () => {
    prisma.politicaSeguranca.findMany.mockResolvedValue([{ papel: "ADMINISTRADOR", doisFatoresObrigatorio: true }])
    const body = await (await GET()).json()
    expect(body.politicas).toEqual([
      { papel: "ANALISTA", doisFatoresObrigatorio: false },
      { papel: "COORDENADOR", doisFatoresObrigatorio: false },
      { papel: "ADMINISTRADOR", doisFatoresObrigatorio: true },
    ])
    expect(body.emailDisponivel).toBe(true)
  })
})

describe("PUT /api/seguranca", () => {
  it("exige o 2FA de um perfil e audita com o e-mail do administrador", async () => {
    const response = await put({ papel: "COORDENADOR", doisFatoresObrigatorio: true })
    expect(response.status).toBe(200)
    expect(prisma.politicaSeguranca.upsert).toHaveBeenCalledWith({
      where: { papel: "COORDENADOR" },
      update: { doisFatoresObrigatorio: true },
      create: { papel: "COORDENADOR", doisFatoresObrigatorio: true },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Política de 2FA alterada", usuario: "admin@teste.com" }),
    })
  })

  it("NÃO deixa exigir o 2FA sem e-mail configurado (trancaria todo mundo do lado de fora)", async () => {
    mail.mailAvailable.mockReturnValue(false)
    const response = await put({ papel: "ANALISTA", doisFatoresObrigatorio: true })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/SMTP/)
    expect(prisma.politicaSeguranca.upsert).not.toHaveBeenCalled()
  })

  it("deixar de exigir é permitido mesmo sem e-mail (é a saída de emergência)", async () => {
    mail.mailAvailable.mockReturnValue(false)
    expect((await put({ papel: "ANALISTA", doisFatoresObrigatorio: false })).status).toBe(200)
  })

  it("recusa perfil inválido e valor que não é booleano", async () => {
    expect((await put({ papel: "ROOT", doisFatoresObrigatorio: true })).status).toBe(400)
    expect((await put({ papel: "ANALISTA", doisFatoresObrigatorio: "sim" })).status).toBe(400)
    expect(prisma.politicaSeguranca.upsert).not.toHaveBeenCalled()
  })
})
