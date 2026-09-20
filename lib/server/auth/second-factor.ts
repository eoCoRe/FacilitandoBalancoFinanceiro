import { prisma } from "@/lib/db"
import { describeError, logEvent } from "@/lib/server/log"
import { ServiceUnavailableError } from "@/lib/server/validation"
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotp,
  normalizeRecoveryCode,
  otpauthUri,
  RECOVERY_CODE_COUNT,
} from "@/lib/server/auth/totp"

// Regra de uso do app autenticador (TOTP): ligar em 2 passos, conferir no login, códigos de
// recuperação e desligar. As rotas só orquestram; o que mexe no banco e decide fica aqui.

// Valor de "cid" no cookie do passo 2 quando o segundo fator é o app (não há desafio no banco).
// Os ids reais têm 32 caracteres hexadecimais, então nunca colidem com este.
export const TOTP_CHALLENGE = "totp"

// Erros de digitação no login e ao ligar: 5 a cada 15 min por usuário.
export const TOTP_LOGIN_KEY = (userId: number) => `2fa:totp:login:${userId}`
export const TOTP_ENROLL_KEY = (userId: number) => `2fa:totp:ativar:${userId}`

// Passo 1 de ligar: gera uma chave NOVA e a guarda cifrada, ainda inativa. Chamar de novo troca a
// chave pendente (a pessoa pode recomeçar o cadastro no app). Devolve a chave em blocos legíveis e
// o endereço otpauth:// — a chave só é mostrada agora, nunca mais.
export async function startTotpEnrollment(usuario: { id: number; email: string }) {
  const secret = generateTotpSecret()
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { totpSegredo: encryptTotpSecret(secret), totpAtivo: false, totpUltimoPasso: null },
  })
  return { segredo: secret.replace(/(.{4})(?=.)/g, "$1 "), uri: otpauthUri(usuario.email, secret) }
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
}

function replaceRecoveryCodes(userId: number, codes: string[]) {
  return [
    prisma.codigoRecuperacao.deleteMany({ where: { usuarioId: userId } }),
    prisma.codigoRecuperacao.createMany({
      data: codes.map((codigo) => ({ usuarioId: userId, codigoHash: hashRecoveryCode(userId, codigo) })),
    }),
  ]
}

// Passo 2 de ligar: confere o primeiro código do app contra a chave pendente. Só então o TOTP vale
// (a pessoa provou que o app está configurado, para não se trancar) e nascem os códigos de recuperação.
// Devolve null se o código não confere, senão os códigos de recuperação (mostrados uma única vez).
export async function confirmTotpEnrollment(usuario: { id: number; totpSegredo: string | null }, rawCode: unknown) {
  if (!usuario.totpSegredo) return null
  const step = matchTotp(decryptTotpSecret(usuario.totpSegredo), rawCode)
  if (step === null) return null

  const codes = generateRecoveryCodes()
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: usuario.id }, data: { totpAtivo: true, totpUltimoPasso: step } }),
    ...replaceRecoveryCodes(usuario.id, codes),
  ])
  return codes
}

export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes()
  await prisma.$transaction(replaceRecoveryCodes(userId, codes))
  return codes
}

export async function disableTotp(userId: number): Promise<void> {
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: userId }, data: { totpAtivo: false, totpSegredo: null, totpUltimoPasso: null } }),
    prisma.codigoRecuperacao.deleteMany({ where: { usuarioId: userId } }),
  ])
}

export type LoginCodeResult = { ok: true; via: "app" | "recuperacao"; restantes?: number } | { ok: false }

// Confere, no login, um código do app (6 dígitos) OU um código de recuperação. Ambos de uso único e
// consumidos de forma atômica no banco — duas requisições simultâneas com o mesmo código não passam as duas.
export async function checkLoginCode(
  usuario: { id: number; totpSegredo: string | null; totpUltimoPasso: number | null },
  rawCode: unknown,
): Promise<LoginCodeResult> {
  const recovery = normalizeRecoveryCode(rawCode)
  if (recovery) {
    const used = await prisma.codigoRecuperacao.updateMany({
      where: { usuarioId: usuario.id, codigoHash: hashRecoveryCode(usuario.id, recovery), usadoEm: null },
      data: { usadoEm: new Date() },
    })
    if (used.count !== 1) return { ok: false }
    const restantes = await prisma.codigoRecuperacao.count({ where: { usuarioId: usuario.id, usadoEm: null } })
    return { ok: true, via: "recuperacao", restantes }
  }

  if (!usuario.totpSegredo) return { ok: false }
  let secret: string
  try {
    secret = decryptTotpSecret(usuario.totpSegredo)
  } catch (error) {
    // A chave foi cifrada com outro AUTH_SECRET (foi trocado) ou o dado está corrompido: sem a chave não há como conferir.
    logEvent("error", "auth.totp.decrypt_failed", { userId: usuario.id, ...describeError(error) })
    throw new ServiceUnavailableError(
      "Não foi possível conferir o código do aplicativo. Peça a um administrador para desligar a verificação em 2 etapas da sua conta e cadastre de novo.",
    )
  }
  const step = matchTotp(secret, rawCode, { afterStep: usuario.totpUltimoPasso })
  if (step === null) return { ok: false }
  const claimed = await prisma.usuario.updateMany({
    where: { id: usuario.id, OR: [{ totpUltimoPasso: null }, { totpUltimoPasso: { lt: step } }] },
    data: { totpUltimoPasso: step },
  })
  return claimed.count === 1 ? { ok: true, via: "app" } : { ok: false }
}
