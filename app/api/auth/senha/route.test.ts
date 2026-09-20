import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/current-user"
import { hashPassword, verifyPassword } from "@/lib/server/password"
import { resetRateLimits } from "@/lib/server/rate-limit"
import { POST } from "./route"

const FAST = { N: 1024, r: 8, p: 1 }
const post = (body: unknown) => POST(new Request("http://localhost/api/auth/senha", { method: "POST", body: JSON.stringify(body) }))

beforeEach(async () => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv("AUTH_SECRET", "s".repeat(40))
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.usuario.findUnique.mockResolvedValue({
    id: 5,
    email: "ana@teste.com",
    senhaHash: await hashPassword("senha-atual-123", FAST),
  })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/senha", () => {
  it("troca a senha, derruba as outras sessões e reemite a desta", async () => {
    const response = await post({ senhaAtual: "senha-atual-123", novaSenha: "senha-nova-4567" })

    expect(response.status).toBe(200)
    const data = prisma.usuario.update.mock.calls[0][0].data
    expect(await verifyPassword("senha-nova-4567", data.senhaHash)).toBe(true)
    expect(data.senhaHash).not.toContain("senha-nova-4567")
    expect(data.sessoesValidasDesde).toBeInstanceOf(Date)
    expect(response.headers.get("set-cookie")).toMatch(/cb_session=/)
  })

  it("recusa se a senha atual estiver errada", async () => {
    const response = await post({ senhaAtual: "errada-errada-1", novaSenha: "senha-nova-4567" })
    expect(response.status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("recusa nova senha fraca (curta)", async () => {
    const response = await post({ senhaAtual: "senha-atual-123", novaSenha: "curta" })
    expect(response.status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("quem só usava o Google (sem senha) define a primeira sem informar a atual", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", senhaHash: null })
    const response = await post({ novaSenha: "primeira-senha-123" })
    expect(response.status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalled()
  })

  it("sessão roubada não adivinha a senha atual: 5 erros bloqueiam (429), mesmo depois acertando", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ senhaAtual: `errada-errada-${i}`, novaSenha: "senha-nova-4567" })).status).toBe(400)
    }
    const response = await post({ senhaAtual: "senha-atual-123", novaSenha: "senha-nova-4567" })
    expect(response.status).toBe(429)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("acertar a senha atual zera o contador de erros", async () => {
    for (let i = 0; i < 4; i++) await post({ senhaAtual: `errada-errada-${i}`, novaSenha: "senha-nova-4567" })
    expect((await post({ senhaAtual: "senha-atual-123", novaSenha: "senha-nova-4567" })).status).toBe(200)
    for (let i = 0; i < 4; i++) {
      expect((await post({ senhaAtual: `outra-errada-${i}`, novaSenha: "senha-nova-4567" })).status).toBe(400)
    }
  })
})
