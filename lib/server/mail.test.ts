import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sendMailFn, createTransport } = vi.hoisted(() => {
  const sendMailFn = vi.fn().mockResolvedValue({})
  return { sendMailFn, createTransport: vi.fn(() => ({ sendMail: sendMailFn })) }
})
vi.mock("nodemailer", () => ({ default: { createTransport } }))

import { mailAvailable, resetMailTransport, sendMail, smtpConfigured } from "./mail"
import { activationCodeMail, loginCodeMail, resetPasswordMail } from "./mail-templates"

const msg = { to: "ana@teste.com", subject: "Assunto", text: "Corpo" }

beforeEach(() => {
  vi.clearAllMocks()
  resetMailTransport()
  vi.stubEnv("SMTP_HOST", "")
  vi.stubEnv("SMTP_FROM", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("configuração", () => {
  it("SMTP só conta como configurado com host E remetente", () => {
    vi.stubEnv("SMTP_HOST", "smtp.exemplo.com")
    expect(smtpConfigured()).toBe(false)
    vi.stubEnv("SMTP_FROM", "app@exemplo.com")
    expect(smtpConfigured()).toBe(true)
  })

  it("em produção, sem SMTP, o e-mail NÃO está disponível (o recurso fica desligado)", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(mailAvailable()).toBe(false)
  })

  it("em desenvolvimento, sem SMTP, está disponível (vai para o console)", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(mailAvailable()).toBe(true)
  })

  it("em produção, com SMTP, está disponível", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SMTP_HOST", "smtp.exemplo.com")
    vi.stubEnv("SMTP_FROM", "app@exemplo.com")
    expect(mailAvailable()).toBe(true)
  })
})

describe("sendMail", () => {
  it("com SMTP: envia pelo transporte com o remetente configurado", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.exemplo.com")
    vi.stubEnv("SMTP_FROM", "app@exemplo.com")
    vi.stubEnv("SMTP_PORT", "465")
    vi.stubEnv("SMTP_USER", "u")
    vi.stubEnv("SMTP_PASS", "p")

    await sendMail(msg)

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.exemplo.com", port: 465, secure: true, auth: { user: "u", pass: "p" } }),
    )
    expect(sendMailFn).toHaveBeenCalledWith({ from: "app@exemplo.com", ...msg })
  })

  it("porta 587 usa STARTTLS (secure=false)", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.exemplo.com")
    vi.stubEnv("SMTP_FROM", "app@exemplo.com")
    await sendMail(msg)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }))
  })

  it("em desenvolvimento sem SMTP: escreve no console e não tenta enviar", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    await sendMail(msg)
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Corpo"))
    expect(sendMailFn).not.toHaveBeenCalled()
    info.mockRestore()
  })

  it("em produção sem SMTP: falha (nunca finge que enviou)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await expect(sendMail(msg)).rejects.toThrow(/SMTP não configurado/)
    expect(sendMailFn).not.toHaveBeenCalled()
  })

  it("propaga a falha do servidor SMTP", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.exemplo.com")
    vi.stubEnv("SMTP_FROM", "app@exemplo.com")
    sendMailFn.mockRejectedValueOnce(new Error("conexão recusada"))
    await expect(sendMail(msg)).rejects.toThrow("conexão recusada")
  })
})

describe("modelos de e-mail", () => {
  it("o link e o prazo aparecem no e-mail de recuperação", () => {
    const m = resetPasswordMail("a@b.com", "https://app/x?token=1", 30)
    expect(m.to).toBe("a@b.com")
    expect(m.text).toContain("https://app/x?token=1")
    expect(m.text).toContain("30 minutos")
  })

  it("o código NUNCA vai no assunto (aparece em notificações)", () => {
    for (const m of [loginCodeMail("a@b.com", "123456", 10), activationCodeMail("a@b.com", "123456", 10)]) {
      expect(m.subject).not.toContain("123456")
      expect(m.text).toContain("123456")
    }
  })
})
