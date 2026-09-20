import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, mail, verification, deferred } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mail: { sendMail: vi.fn(), mailAvailable: vi.fn() },
  verification: { createResetToken: vi.fn() },
  deferred: { tasks: [] as Promise<void>[] },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/mail/mail", () => ({ sendMail: mail.sendMail, mailAvailable: mail.mailAvailable }))
vi.mock("@/lib/server/auth/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/verification")>()),
  createResetToken: verification.createResetToken,
}))
// Executa a tarefa "depois da resposta" na hora, guardando a promessa para o teste esperar.
vi.mock("@/lib/server/after-response", () => ({
  afterResponse: (task: () => Promise<void>) => {
    deferred.tasks.push(task())
  },
}))

import { resetRateLimits } from "@/lib/server/auth/rate-limit"
import { POST } from "./route"

const post = (body: unknown, ip = "1.1.1.1") =>
  POST(
    new Request("http://evil-host.example/api/auth/recuperar-senha", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  )
const flush = () => Promise.all(deferred.tasks.splice(0))

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  deferred.tasks.length = 0
  vi.stubEnv("APP_URL", "https://app.exemplo.com")
  mail.mailAvailable.mockReturnValue(true)
  mail.sendMail.mockResolvedValue(undefined)
  verification.createResetToken.mockResolvedValue("ID.SEGREDO")
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/recuperar-senha", () => {
  it("e-mail cadastrado: envia o link, apontando para APP_URL (não para o Host da requisição)", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true })

    const response = await post({ email: "ANA@teste.com" })
    await flush()

    expect(response.status).toBe(200)
    expect(mail.sendMail).toHaveBeenCalledTimes(1)
    const enviado = mail.sendMail.mock.calls[0][0]
    expect(enviado.to).toBe("ana@teste.com")
    expect(enviado.text).toContain("https://app.exemplo.com/redefinir-senha?token=ID.SEGREDO")
    expect(enviado.text).not.toContain("evil-host")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Recuperação de senha solicitada", usuario: "ana@teste.com" }),
    })
  })

  it("e-mail inexistente: MESMA resposta, sem token e sem e-mail (não revela quem está cadastrado)", async () => {
    prisma.usuario.findUnique.mockResolvedValueOnce({ id: 5, email: "ana@teste.com", ativo: true })
    const existente = await post({ email: "ana@teste.com" }, "2.2.2.2")
    prisma.usuario.findUnique.mockResolvedValueOnce(null)
    const inexistente = await post({ email: "ninguem@teste.com" }, "3.3.3.3")
    await flush()

    expect(inexistente.status).toBe(existente.status)
    expect(await inexistente.json()).toEqual(await existente.json())
    expect(verification.createResetToken).toHaveBeenCalledTimes(1)
    expect(mail.sendMail).toHaveBeenCalledTimes(1)
  })

  it("conta desativada: mesma resposta e nada enviado", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: false })
    const response = await post({ email: "ana@teste.com" })
    await flush()
    expect(response.status).toBe(200)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("o e-mail sai DEPOIS da resposta (o tempo de resposta não entrega se a conta existe)", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true })
    let liberar!: () => void
    mail.sendMail.mockReturnValue(new Promise<void>((resolve) => (liberar = resolve)))

    const response = await post({ email: "ana@teste.com" }) // resolve sem esperar o envio terminar
    expect(response.status).toBe(200)
    liberar()
    await flush()
  })

  it("falha no envio não vira erro para quem pediu", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true })
    mail.sendMail.mockRejectedValue(new Error("SMTP fora"))
    const response = await post({ email: "ana@teste.com" })
    expect(response.status).toBe(200)
    await expect(flush()).rejects.toThrow("SMTP fora") // a rejeição fica na tarefa pós-resposta
  })

  it("limite por e-mail: o 4º pedido em 15 min recebe 429, exista a conta ou não", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    for (let i = 0; i < 3; i++) expect((await post({ email: "alguem@teste.com" }, `9.9.9.${i}`)).status).toBe(200)
    expect((await post({ email: "alguem@teste.com" }, "9.9.9.9")).status).toBe(429)
  })

  it("sem e-mail configurado (produção sem SMTP): 503, sem consultar o banco", async () => {
    mail.mailAvailable.mockReturnValue(false)
    const response = await post({ email: "ana@teste.com" })
    expect(response.status).toBe(503)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("rejeita e-mail malformado com 400", async () => {
    expect((await post({ email: "nao-eh-email" })).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })

  it("nem a criação do token roda antes da resposta (o caminho síncrono é o mesmo exista a conta ou não)", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true })
    let liberar!: (t: string) => void
    verification.createResetToken.mockReturnValue(new Promise<string>((resolve) => (liberar = resolve)))

    const response = await post({ email: "ana@teste.com" }) // não pode esperar o token
    expect(response.status).toBe(200)
    expect(mail.sendMail).not.toHaveBeenCalled()

    liberar("ID.SEGREDO")
    await flush()
    expect(mail.sendMail).toHaveBeenCalledTimes(1)
  })

  it("em PRODUÇÃO sem APP_URL: 503 e nada é feito (o link usaria o Host, que o atacante controla)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_URL", "")
    const response = await post({ email: "ana@teste.com" })
    expect(response.status).toBe(503)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
    expect(mail.sendMail).not.toHaveBeenCalled()
  })
})
