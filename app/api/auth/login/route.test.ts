import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { hashPassword } from "@/lib/server/password"
import { resetRateLimits } from "@/lib/server/rate-limit"
import { POST } from "./route"

const SENHA = "senha-correta-123"
const FAST = { N: 1024, r: 8, p: 1 }

function login(body: unknown, ip = "1.1.1.1") {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  )
}

async function usuario(over = {}) {
  return {
    id: 5,
    email: "ana@teste.com",
    nome: "Ana",
    papel: "ANALISTA",
    ativo: true,
    senhaHash: await hashPassword(SENHA, FAST),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv("AUTH_SECRET", "l".repeat(40))
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/login", () => {
  it("com credenciais corretas: 200, cookie de sessão httpOnly e auditoria com o e-mail", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario())

    const response = await login({ email: "  ANA@teste.com ", senha: SENHA })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.user).toEqual({ id: 5, nome: "Ana", email: "ana@teste.com", papel: "ANALISTA" })
    expect(JSON.stringify(body)).not.toMatch(/senha|hash/i)
    const cookie = response.headers.get("set-cookie")!
    expect(cookie).toMatch(/cb_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({ where: { email: "ana@teste.com" } })
    expect(prisma.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: { ultimoLoginEm: expect.any(Date) } }),
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Login realizado", usuario: "ana@teste.com" }),
    })
  })

  it("senha errada: 401 genérico, sem cookie, e registra a recusa na auditoria", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario())

    const response = await login({ email: "ana@teste.com", senha: "senha-errada-123" })

    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("E-mail ou senha inválidos.")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Login recusado", usuario: "ana@teste.com" }),
    })
  })

  it("e-mail inexistente: mesma resposta da senha errada e nada na auditoria", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    const response = await login({ email: "ninguem@teste.com", senha: SENHA })

    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("E-mail ou senha inválidos.")
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("conta desativada não entra, mesmo com a senha certa", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ ativo: false }))
    const response = await login({ email: "ana@teste.com", senha: SENHA })
    expect(response.status).toBe(401)
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("conta só-Google (sem senha) não entra por senha", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ senhaHash: null }))
    const response = await login({ email: "ana@teste.com", senha: SENHA })
    expect(response.status).toBe(401)
  })

  it("depois de 5 falhas no mesmo e-mail responde 429 e nem consulta mais o banco", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario())
    for (let i = 0; i < 5; i++) {
      // IPs diferentes: prova que o limite por e-mail vale mesmo se o atacante trocar de IP.
      expect((await login({ email: "ana@teste.com", senha: "errada-errada-1" }, `9.9.9.${i}`)).status).toBe(401)
    }
    prisma.usuario.findUnique.mockClear()

    const response = await login({ email: "ana@teste.com", senha: SENHA }, "8.8.8.8")

    expect(response.status).toBe(429)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("um login bem-sucedido zera o contador de falhas do e-mail", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario())
    for (let i = 0; i < 4; i++) await login({ email: "ana@teste.com", senha: "errada-errada-1" })
    expect((await login({ email: "ana@teste.com", senha: SENHA })).status).toBe(200)
    for (let i = 0; i < 4; i++) {
      expect((await login({ email: "ana@teste.com", senha: "errada-errada-1" })).status).toBe(401)
    }
  })

  it("rejeita corpo inválido com 400, sem consultar o banco", async () => {
    expect((await login({ email: "nao-eh-email", senha: SENHA })).status).toBe(400)
    expect((await login({ email: "ana@teste.com" })).status).toBe(400)
    expect((await login({ email: "ana@teste.com", senha: "a".repeat(500) })).status).toBe(400)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("falha na auditoria não impede o login", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario())
    prisma.auditLog.create.mockRejectedValue(new Error("banco fora"))
    expect((await login({ email: "ana@teste.com", senha: SENHA })).status).toBe(200)
  })
})
