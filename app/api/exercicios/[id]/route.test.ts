import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    exercicio: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/current-user"
import { PATCH } from "./route"

const patch = (id: string | number, body: unknown) =>
  PATCH(new Request("http://localhost/api/exercicios/x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  })

const exercicio = (over = {}) => ({ id: 3, empresaId: 1, periodo: "1T2026", auditado: false, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.exercicio.findUnique.mockResolvedValue(exercicio())
  prisma.exercicio.update.mockImplementation(async ({ data }) => exercicio({ auditado: data.auditado }))
})

describe("PATCH /api/exercicios/:id", () => {
  it("marca como auditado e registra na auditoria com o e-mail de quem marcou", async () => {
    const response = await patch(3, { auditado: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 3, periodo: "1T2026", auditado: true })
    expect(prisma.exercicio.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { auditado: true } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: "Exercício marcado como auditado",
        detalhe: "1T2026.",
        usuario: "admin@teste.com",
      }),
    })
  })

  it("desmarcar também é registrado, com texto próprio", async () => {
    prisma.exercicio.findUnique.mockResolvedValue(exercicio({ auditado: true }))
    await patch(3, { auditado: false })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Exercício desmarcado como auditado" }),
    })
  })

  it("repetir o mesmo estado é inofensivo: não grava nem polui a auditoria", async () => {
    prisma.exercicio.findUnique.mockResolvedValue(exercicio({ auditado: true }))
    const response = await patch(3, { auditado: true })
    expect(response.status).toBe(200)
    expect(prisma.exercicio.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("recusa exercício inexistente e exercício de OUTRA empresa", async () => {
    prisma.exercicio.findUnique.mockResolvedValue(null)
    expect((await patch(99, { auditado: true })).status).toBe(400)
    prisma.exercicio.findUnique.mockResolvedValue(exercicio({ empresaId: 2 }))
    expect((await patch(3, { auditado: true })).status).toBe(400)
    expect(prisma.exercicio.update).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ auditado: "sim" }], [{ auditado: 1 }], [{ auditado: null }]])(
    "recusa corpo inválido %j com 400",
    async (body) => {
      expect((await patch(3, body)).status).toBe(400)
      expect(prisma.exercicio.update).not.toHaveBeenCalled()
    },
  )

  it("recusa id que não é inteiro positivo", async () => {
    expect((await patch("abc", { auditado: true })).status).toBe(400)
    expect((await patch(0, { auditado: true })).status).toBe(400)
  })

  it("analista NÃO pode marcar (403), nem consulta o banco", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "a@teste.com", nome: "A", papel: "ANALISTA" })
    const response = await patch(3, { auditado: true })
    expect(response.status).toBe(403)
    expect(prisma.exercicio.findUnique).not.toHaveBeenCalled()
  })

  it("coordenador pode", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 6, email: "c@teste.com", nome: "C", papel: "COORDENADOR" })
    expect((await patch(3, { auditado: true })).status).toBe(200)
  })
})
