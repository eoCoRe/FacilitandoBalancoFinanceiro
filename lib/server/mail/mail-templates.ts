import type { MailMessage } from "@/lib/server/mail/mail"

// Textos dos e-mails. Sempre dizem o que fazer se NÃO foi a pessoa que pediu, e o código nunca
// vai no assunto (aparece em pré-visualizações de notificação).

export function resetPasswordMail(to: string, link: string, minutes: number): MailMessage {
  return {
    to,
    subject: "Central de Balanços — redefinição de senha",
    text: [
      "Recebemos um pedido para redefinir a senha do seu acesso à Central de Balanços.",
      "",
      `Para escolher uma nova senha, abra o link abaixo (vale por ${minutes} minutos e só pode ser usado uma vez):`,
      link,
      "",
      "Se não foi você, ignore este e-mail: a sua senha continua a mesma.",
    ].join("\n"),
  }
}

export function loginCodeMail(to: string, code: string, minutes: number): MailMessage {
  return {
    to,
    subject: "Central de Balanços — código de verificação",
    text: [
      `Seu código de verificação para entrar na Central de Balanços é: ${code}`,
      "",
      `Ele vale por ${minutes} minutos e só pode ser usado uma vez. Nunca compartilhe este código.`,
      "",
      "Se não foi você quem tentou entrar, altere a sua senha: alguém pode ter descoberto a atual.",
    ].join("\n"),
  }
}

export function activationCodeMail(to: string, code: string, minutes: number): MailMessage {
  return {
    to,
    subject: "Central de Balanços — confirmar verificação em 2 etapas",
    text: [
      `Para ligar a verificação em 2 etapas na sua conta, informe o código: ${code}`,
      "",
      `Ele vale por ${minutes} minutos. Se não foi você, ignore este e-mail: nada será alterado.`,
    ].join("\n"),
  }
}
