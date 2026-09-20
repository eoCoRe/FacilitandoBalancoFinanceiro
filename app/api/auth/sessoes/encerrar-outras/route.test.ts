import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

const cookieStore = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "cb_session" && cookieStore.token ? { value: cookieStore.token } : undefined) }),
}))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { signSessionToken, verifySessionToken } from "@/lib/server/auth/session"
import { POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.token = undefined
  vi.stubEnv("AUTH_SECRET", "e".repeat(40))
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/sessoes/encerrar-outras", () => {
  it("invalida as sessões abertas (sessoesValidasDesde = agora) e reemite o cookie DESTA sessão", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })

    const response = await POST()

    expect(response.status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { sessoesValidasDesde: expect.any(Date) },
    })
    expect(response.headers.getSetCookie().join(";")).toMatch(/cb_session=[^;]+/) // quem clicou continua logado
  })

  it("o cookie reemitido MANTÉM o momento do login original (não reinicia o teto de 24 h)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
    const loginOriginal = Math.floor(Date.now() / 1000) - 20 * 3600 // logou há 20 h
    cookieStore.token = await signSessionToken(5, loginOriginal)

    const response = await POST()

    const novo = response.headers.getSetCookie().join(";").match(/cb_session=([^;]+)/)![1]
    const sessao = await verifySessionToken(novo)
    expect(sessao!.authTime).toBe(loginOriginal)
    expect(sessao!.issuedAt).toBeGreaterThan(loginOriginal) // o token é novo, o login é o de antes
  })

  it("audita com o e-mail de quem encerrou", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
    await POST()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Outras sessões encerradas", usuario: "ana@teste.com" }),
    })
  })

  it("sem login: 401 e nada é alterado", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await POST()
    expect(response.status).toBe(401)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })
})
