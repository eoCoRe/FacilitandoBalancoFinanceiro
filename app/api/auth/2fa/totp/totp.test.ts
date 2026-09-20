import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, sf } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    politicaSeguranca: { findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  sf: {
    startTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    disableTotp: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/second-factor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/second-factor")>()),
  ...sf,
}))

import { getCurrentUser } from "@/lib/server/current-user"
import { hashPassword } from "@/lib/server/password"
import { resetRateLimits } from "@/lib/server/rate-limit"
import { POST as codigos } from "./codigos/route"
import { POST as confirmar } from "./confirmar/route"
import { POST as desativar } from "./desativar/route"
import { POST as iniciar } from "./iniciar/route"

const SENHA = "minha-senha-123"
const FAST = { N: 1024, r: 8, p: 1 }
const post = (handler: (r: Request) => Promise<Response>, body: unknown = {}) =>
  handler(new Request("http://localhost/api/auth/2fa/totp/x", { method: "POST", body: JSON.stringify(body) }))

async function usuario(over = {}) {
  return {
    id: 5,
    email: "ana@teste.com",
    papel: "ANALISTA",
    senhaHash: await hashPassword(SENHA, FAST),
    doisFatoresAtivo: false,
    totpAtivo: false,
    totpSegredo: null,
    ...over,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.politicaSeguranca.findUnique.mockResolvedValue(null)
  prisma.usuario.findUnique.mockResolvedValue(await usuario())
  sf.startTotpEnrollment.mockResolvedValue({ segredo: "ABCD EFGH", uri: "otpauth://totp/x" })
  sf.confirmTotpEnrollment.mockResolvedValue(["AAAAA-BBBBB"])
  sf.regenerateRecoveryCodes.mockResolvedValue(["CCCCC-DDDDD"])
  sf.disableTotp.mockResolvedValue(undefined)
})

describe("POST /api/auth/2fa/totp/iniciar", () => {
  it("com a senha certa devolve a chave e o endereço para cadastrar no app", async () => {
    const response = await post(iniciar, { senha: SENHA })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ segredo: "ABCD EFGH", uri: "otpauth://totp/x" })
    expect(sf.startTotpEnrollment).toHaveBeenCalledWith(expect.objectContaining({ id: 5, email: "ana@teste.com" }))
  })

  it.each([[{ senha: "errada-123" }], [{}], [{ senha: 123 }]])("senha ausente ou errada (%j): 400 e NENHUMA chave é gerada", async (body) => {
    expect((await post(iniciar, body)).status).toBe(400)
    expect(sf.startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("errar a senha demais bloqueia (429), como nas outras conferências da senha atual", async () => {
    for (let i = 0; i < 5; i++) await post(iniciar, { senha: "errada-123" })
    expect((await post(iniciar, { senha: SENHA })).status).toBe(429)
    expect(sf.startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("já ligado: 400 (não troca a chave de quem já usa)", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true }))
    expect((await post(iniciar, { senha: SENHA })).status).toBe(400)
    expect(sf.startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("conta sem senha (só Google) não consegue: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ senhaHash: null }))
    expect((await post(iniciar, { senha: SENHA })).status).toBe(400)
  })
})

describe("POST /api/auth/2fa/totp/confirmar", () => {
  beforeEach(async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpSegredo: "v1.x.y.z" }))
  })

  it("código certo: liga, devolve os códigos de recuperação e audita (sem gravar códigos na trilha)", async () => {
    const response = await post(confirmar, { codigo: "123456" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, codigosRecuperacao: ["AAAAA-BBBBB"] })
    const audit = prisma.auditLog.create.mock.calls[0][0].data
    expect(audit).toMatchObject({ acao: "App autenticador ativado", usuario: "ana@teste.com" })
    expect(JSON.stringify(audit)).not.toContain("AAAAA")
  })

  it("código errado: 400, nada liga; depois de 5 erros, 429", async () => {
    sf.confirmTotpEnrollment.mockResolvedValue(null)
    for (let i = 0; i < 5; i++) expect((await post(confirmar, { codigo: "000000" })).status).toBe(400)
    expect((await post(confirmar, { codigo: "000000" })).status).toBe(429)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("sem ter começado o cadastro (sem chave pendente): 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpSegredo: null }))
    expect((await post(confirmar, { codigo: "123456" })).status).toBe(400)
    expect(sf.confirmTotpEnrollment).not.toHaveBeenCalled()
  })

  it("já ligado: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true, totpSegredo: "v1.x.y.z" }))
    expect((await post(confirmar, { codigo: "123456" })).status).toBe(400)
  })
})

describe("POST /api/auth/2fa/totp/desativar", () => {
  beforeEach(async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true }))
  })

  it("com a senha certa desliga, apaga os códigos e audita", async () => {
    expect((await post(desativar, { senha: SENHA })).status).toBe(200)
    expect(sf.disableTotp).toHaveBeenCalledWith(5)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: "App autenticador desativado" }) })
  })

  it("sem a senha ou com a senha errada: 400 e continua ligado", async () => {
    expect((await post(desativar, {})).status).toBe(400)
    expect((await post(desativar, { senha: "errada-123" })).status).toBe(400)
    expect(sf.disableTotp).not.toHaveBeenCalled()
  })

  it("perfil que EXIGE 2 etapas e não tem o e-mail ligado: não pode desligar o único fator", async () => {
    prisma.politicaSeguranca.findUnique.mockResolvedValue({ papel: "ANALISTA", doisFatoresObrigatorio: true })
    const response = await post(desativar, { senha: SENHA })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/exige/)
    expect(sf.disableTotp).not.toHaveBeenCalled()
  })

  it("perfil que exige 2 etapas MAS tem o e-mail ligado: pode desligar o app", async () => {
    prisma.politicaSeguranca.findUnique.mockResolvedValue({ papel: "ANALISTA", doisFatoresObrigatorio: true })
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true, doisFatoresAtivo: true }))
    expect((await post(desativar, { senha: SENHA })).status).toBe(200)
  })

  it("já desligado: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: false }))
    expect((await post(desativar, { senha: SENHA })).status).toBe(400)
  })
})

describe("POST /api/auth/2fa/totp/codigos", () => {
  beforeEach(async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: true }))
  })

  it("com a senha certa gera novos códigos e audita", async () => {
    const response = await post(codigos, { senha: SENHA })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, codigosRecuperacao: ["CCCCC-DDDDD"] })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: "Códigos de recuperação renovados" }) })
  })

  it("sem a senha certa: 400 e os códigos antigos continuam valendo", async () => {
    expect((await post(codigos, { senha: "errada-123" })).status).toBe(400)
    expect(sf.regenerateRecoveryCodes).not.toHaveBeenCalled()
  })

  it("sem o app ligado: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(await usuario({ totpAtivo: false }))
    expect((await post(codigos, { senha: SENHA })).status).toBe(400)
  })
})

describe("sem login", () => {
  it.each([
    ["iniciar", iniciar],
    ["confirmar", confirmar],
    ["desativar", desativar],
    ["codigos", codigos],
  ])("%s: 401 e nada acontece", async (_nome, handler) => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await post(handler, { senha: SENHA, codigo: "123456" })).status).toBe(401)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })
})
