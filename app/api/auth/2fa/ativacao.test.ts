import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, mail, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    politicaSeguranca: { findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mail: { sendMail: vi.fn(), mailAvailable: vi.fn() },
  verification: { createCodeChallenge: vi.fn(), checkCode: vi.fn(), latestPendingChallengeId: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/mail", () => ({ sendMail: mail.sendMail, mailAvailable: mail.mailAvailable }))
vi.mock("@/lib/server/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/verification")>()),
  ...verification,
}))

import { getCurrentUser } from "@/lib/server/current-user"
import { hashPassword } from "@/lib/server/password"
import { resetRateLimits } from "@/lib/server/rate-limit"
import { POST as ativar } from "./ativar/route"
import { POST as confirmar } from "./confirmar/route"
import { POST as desativar } from "./desativar/route"

const post = (handler: (r: Request) => Promise<Response>, body: unknown = {}) =>
  handler(new Request("http://localhost/api/auth/2fa/x", { method: "POST", body: JSON.stringify(body) }))
const FAST = { N: 1024, r: 8, p: 1 }

beforeEach(async () => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.politicaSeguranca.findUnique.mockResolvedValue(null)
  prisma.usuario.findUnique.mockResolvedValue({
    id: 5,
    email: "ana@teste.com",
    papel: "ANALISTA",
    doisFatoresAtivo: false,
    senhaHash: await hashPassword("minha-senha-123", FAST),
  })
  mail.mailAvailable.mockReturnValue(true)
  mail.sendMail.mockResolvedValue(undefined)
  verification.createCodeChallenge.mockResolvedValue({ id: "ativ-1", code: "246810" })
  verification.latestPendingChallengeId.mockResolvedValue("ativ-1")
  verification.checkCode.mockResolvedValue("ok")
})

describe("ligar o 2FA: POST /api/auth/2fa/ativar + /confirmar", () => {
  it("ativar só ENVIA o código: o 2FA ainda não liga (ninguém se tranca com e-mail que não recebe)", async () => {
    const response = await post(ativar)
    expect(response.status).toBe(200)
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("246810") }))
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("confirmar com o código certo liga o 2FA e audita", async () => {
    const response = await post(confirmar, { codigo: "246810" })
    expect(response.status).toBe(200)
    expect(verification.checkCode).toHaveBeenCalledWith("ativ-1", 5, "ATIVACAO_2FA", "246810")
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { doisFatoresAtivo: true } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "2FA ativado", usuario: "ana@teste.com" }),
    })
  })

  it.each([
    ["invalido", /incorreto/i],
    ["expirado", /expirou/i],
    ["bloqueado", /tentativas/i],
  ])("confirmar com código %s: 400 e NÃO liga", async (resultado, mensagem) => {
    verification.checkCode.mockResolvedValue(resultado)
    const response = await post(confirmar, { codigo: "000000" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(mensagem)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("confirmar sem ter pedido código: 400", async () => {
    verification.latestPendingChallengeId.mockResolvedValue(null)
    expect((await post(confirmar, { codigo: "246810" })).status).toBe(400)
    expect(verification.checkCode).not.toHaveBeenCalled()
  })

  it("ativar quando já está ligado: 400, nada enviado", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", doisFatoresAtivo: true })
    expect((await post(ativar)).status).toBe(400)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("ativar sem e-mail configurado: 503", async () => {
    mail.mailAvailable.mockReturnValue(false)
    expect((await post(ativar)).status).toBe(503)
  })

  it("limite de 3 códigos de ativação em 15 min", async () => {
    for (let i = 0; i < 3; i++) expect((await post(ativar)).status).toBe(200)
    expect((await post(ativar)).status).toBe(429)
  })
})

describe("desligar o 2FA: POST /api/auth/2fa/desativar", () => {
  beforeEach(async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      id: 5,
      email: "ana@teste.com",
      papel: "ANALISTA",
      doisFatoresAtivo: true,
      senhaHash: await hashPassword("minha-senha-123", FAST),
    })
  })

  it("com a senha certa, desliga e audita", async () => {
    const response = await post(desativar, { senha: "minha-senha-123" })
    expect(response.status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { doisFatoresAtivo: false } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "2FA desativado", usuario: "ana@teste.com" }),
    })
  })

  it("senha errada ou ausente: 400, continua ligado (sessão emprestada não enfraquece a conta)", async () => {
    expect((await post(desativar, { senha: "errada-errada-1" })).status).toBe(400)
    expect((await post(desativar, {})).status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("perfil que EXIGE 2FA não pode desligar, nem com a senha certa", async () => {
    prisma.politicaSeguranca.findUnique.mockResolvedValue({ papel: "ANALISTA", doisFatoresObrigatorio: true })
    const response = await post(desativar, { senha: "minha-senha-123" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/exige/)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("já desligado: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", papel: "ANALISTA", doisFatoresAtivo: false })
    expect((await post(desativar, { senha: "minha-senha-123" })).status).toBe(400)
  })
})
