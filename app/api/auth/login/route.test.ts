import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, mail, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    politicaSeguranca: { findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mail: { sendMail: vi.fn(), mailAvailable: vi.fn() },
  verification: { createCodeChallenge: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/mail/mail", () => ({ sendMail: mail.sendMail, mailAvailable: mail.mailAvailable }))
vi.mock("@/lib/server/auth/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/verification")>()),
  createCodeChallenge: verification.createCodeChallenge,
}))

import { hashPassword } from "@/lib/server/auth/password"
import { resetRateLimits } from "@/lib/server/auth/rate-limit"
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
  prisma.politicaSeguranca.findUnique.mockResolvedValue(null)
  mail.mailAvailable.mockReturnValue(true)
  mail.sendMail.mockResolvedValue(undefined)
  verification.createCodeChallenge.mockResolvedValue({ id: "desafio-1", code: "123456" })
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

describe("POST /api/auth/login com verificação em 2 etapas", () => {
  const cookies = (response: Response) => response.headers.getSetCookie().join(";")

  it("acertar a senha NÃO cria sessão: envia o código, guarda só o cookie temporário e pede o 2º passo", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: true }))

    const response = await login({ email: "ana@teste.com", senha: SENHA })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ segundoFator: true, metodo: "email" })
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
    expect(cookies(response)).toMatch(/cb_2fa=[^;]+/)
    expect(cookies(response)).toMatch(/HttpOnly/i)
    expect(cookies(response)).toMatch(/SameSite=strict/i)
    expect(mail.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@teste.com", text: expect.stringContaining("123456") }),
    )
    // ainda não é um login: nada de "último acesso" nem de "Login realizado" na auditoria
    expect(prisma.usuario.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("perfil com 2FA obrigatório exige o código mesmo que o usuário não tenha ligado", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: false }))
    prisma.politicaSeguranca.findUnique.mockResolvedValue({ papel: "ANALISTA", doisFatoresObrigatorio: true })

    const response = await login({ email: "ana@teste.com", senha: SENHA })

    expect(await response.json()).toEqual({ segundoFator: true, metodo: "email" })
    expect(prisma.politicaSeguranca.findUnique).toHaveBeenCalledWith({ where: { papel: "ANALISTA" } })
  })

  it("com o app autenticador ligado: pede o código do app (metodo 'app'), NÃO envia e-mail e não cria sessão", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true, doisFatoresAtivo: true }))

    const response = await login({ email: "ana@teste.com", senha: SENHA })

    expect(await response.json()).toEqual({ segundoFator: true, metodo: "app" })
    expect(cookies(response)).toMatch(/cb_2fa=[^;]+/)
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
    expect(mail.sendMail).not.toHaveBeenCalled()
    expect(verification.createCodeChallenge).not.toHaveBeenCalled()
  })

  it("o app funciona SEM e-mail configurado (é a vantagem: não depende do SMTP)", async () => {
    mail.mailAvailable.mockReturnValue(false)
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true }))
    const response = await login({ email: "ana@teste.com", senha: SENHA })
    expect(response.status).toBe(200)
    expect((await response.json()).metodo).toBe("app")
  })

  it("senha errada continua barrando ANTES do código: nenhum e-mail é enviado", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: true }))
    const response = await login({ email: "ana@teste.com", senha: "senha-errada-123" })
    expect(response.status).toBe(401)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("falha FECHADO: se o e-mail não puder ser enviado, o login não conclui (503, sem sessão)", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: true }))
    mail.sendMail.mockRejectedValue(new Error("SMTP fora"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await login({ email: "ana@teste.com", senha: SENHA })

    expect(response.status).toBe(503)
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
    expect(cookies(response)).not.toMatch(/cb_2fa=[^;]/)
  })

  it("sem e-mail configurado o 2FA também não é contornado: 503", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: true }))
    mail.mailAvailable.mockReturnValue(false)
    const response = await login({ email: "ana@teste.com", senha: SENHA })
    expect(response.status).toBe(503)
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
  })

  it("quem sabe a senha não pode pedir códigos sem fim: a partir do 6º desafio, 429", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ doisFatoresAtivo: true }))
    for (let i = 0; i < 5; i++) expect((await login({ email: "ana@teste.com", senha: SENHA })).status).toBe(200)
    mail.sendMail.mockClear()
    const response = await login({ email: "ana@teste.com", senha: SENHA })
    expect(response.status).toBe(429)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("login recusado vai para o log estruturado com e-mail MASCARADO e nunca a senha", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prisma.usuario.findUnique.mockResolvedValue(await usuario())

    await login({ email: "ana@teste.com", senha: "senha-errada-secreta-9" })

    const linhas = warn.mock.calls.map((c) => c[0] as string)
    const evento = JSON.parse(linhas.find((l) => l.includes("auth.login.failed"))!)
    expect(evento).toMatchObject({ level: "warn", event: "auth.login.failed", email: "a**@teste.com", ip: "1.1.1.1" })
    expect(linhas.join("\n")).not.toContain("senha-errada-secreta-9")
    expect(linhas.join("\n")).not.toContain("ana@teste.com")
    warn.mockRestore()
  })

  it("bloqueio por tentativas também é registrado (para quem opera o sistema notar um ataque)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prisma.usuario.findUnique.mockResolvedValue(await usuario())
    for (let i = 0; i < 5; i++) await login({ email: "ana@teste.com", senha: "errada-errada-1" }, `9.9.9.${i}`)
    warn.mockClear()

    await login({ email: "ana@teste.com", senha: SENHA }, "8.8.8.8")

    expect(warn.mock.calls.map((c) => c[0] as string).some((l) => l.includes("auth.login.rate_limited"))).toBe(true)
    warn.mockRestore()
  })
})
