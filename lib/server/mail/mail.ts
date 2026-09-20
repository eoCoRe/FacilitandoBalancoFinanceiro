import nodemailer, { type Transporter } from "nodemailer"

// Envio de e-mail por SMTP (qualquer provedor: Gmail com senha de app, Resend, Mailtrap...).
// Usado pela recuperação de senha e pelo código de 2 etapas.

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM)
}

// Em desenvolvimento, sem SMTP, a mensagem vai para o console do servidor (dá para testar o
// fluxo sem provedor). Em produção, sem SMTP o recurso fica DESLIGADO: nunca finge que enviou.
export function mailAvailable(): boolean {
  return smtpConfigured() || process.env.NODE_ENV !== "production"
}

let transporter: Transporter | undefined

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587)
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 usa TLS direto; as demais portas (587) sobem para TLS via STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  }
  return transporter
}

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (smtpConfigured()) {
    await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...message })
    return
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[e-mail de desenvolvimento — SMTP não configurado]\nPara: ${message.to}\nAssunto: ${message.subject}\n\n${message.text}\n`)
    return
  }
  throw new Error("SMTP não configurado (SMTP_HOST/SMTP_FROM) — veja .env.example")
}

// Só para testes.
export function resetMailTransport(): void {
  transporter = undefined
}
