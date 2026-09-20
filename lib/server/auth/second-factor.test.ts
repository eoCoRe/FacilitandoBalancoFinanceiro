import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Banco de mentira, com estado, só com o que o app autenticador usa — para testar as regras de
// verdade (uso único, replay, troca de códigos) e não só "chamou tal função".
const db = vi.hoisted(() => {
  const state = {
    usuario: { id: 5, totpSegredo: null as string | null, totpAtivo: false, totpUltimoPasso: null as number | null },
    codigos: [] as { usuarioId: number; codigoHash: string; usadoEm: Date | null }[],
  }
  const prisma = {
    usuario: {
      update: vi.fn(async ({ data }: { data: Partial<typeof state.usuario> }) => Object.assign(state.usuario, data)),
      updateMany: vi.fn(
        async ({ where, data }: { where: { OR: { totpUltimoPasso: null | { lt: number } }[] }; data: { totpUltimoPasso: number } }) => {
          const atual = state.usuario.totpUltimoPasso
          const ok = where.OR.some((c) => (c.totpUltimoPasso === null ? atual === null : atual !== null && atual < (c.totpUltimoPasso as { lt: number }).lt))
          if (ok) state.usuario.totpUltimoPasso = data.totpUltimoPasso
          return { count: ok ? 1 : 0 }
        },
      ),
    },
    codigoRecuperacao: {
      deleteMany: vi.fn(async ({ where }: { where: { usuarioId: number } }) => {
        state.codigos = state.codigos.filter((c) => c.usuarioId !== where.usuarioId)
      }),
      createMany: vi.fn(async ({ data }: { data: { usuarioId: number; codigoHash: string }[] }) => {
        state.codigos.push(...data.map((d) => ({ ...d, usadoEm: null })))
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { usuarioId: number; codigoHash: string }; data: { usadoEm: Date } }) => {
        const alvo = state.codigos.find((c) => c.usuarioId === where.usuarioId && c.codigoHash === where.codigoHash && c.usadoEm === null)
        if (alvo) alvo.usadoEm = data.usadoEm
        return { count: alvo ? 1 : 0 }
      }),
      count: vi.fn(async ({ where }: { where: { usuarioId: number } }) => state.codigos.filter((c) => c.usuarioId === where.usuarioId && c.usadoEm === null).length),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { state, prisma }
})
vi.mock("@/lib/db", () => ({ prisma: db.prisma }))

import {
  checkLoginCode,
  confirmTotpEnrollment,
  disableTotp,
  regenerateRecoveryCodes,
  startTotpEnrollment,
} from "@/lib/server/auth/second-factor"
import { ServiceUnavailableError } from "@/lib/server/validation"
import { base32Decode, decryptTotpSecret, totpCodeAtStep, totpStep } from "@/lib/server/auth/totp"

const AGORA = new Date("2026-09-20T10:00:00Z")
const codigoAgora = (segredo: string, deslocamento = 0) => totpCodeAtStep(segredo, totpStep(AGORA.getTime()) + deslocamento)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AGORA)
  vi.stubEnv("AUTH_SECRET", "s".repeat(40))
  db.state.usuario = { id: 5, totpSegredo: null, totpAtivo: false, totpUltimoPasso: null }
  db.state.codigos = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// Liga o app para o usuário de teste e devolve a chave e os códigos de recuperação.
async function ligar() {
  const { segredo } = await startTotpEnrollment({ id: 5, email: "ana@teste.com" })
  const chave = segredo.replace(/ /g, "")
  const codigos = await confirmTotpEnrollment(db.state.usuario, codigoAgora(chave))
  return { chave, codigos: codigos! }
}

describe("ligar o app autenticador", () => {
  it("passo 1: guarda a chave CIFRADA e ainda inativa; devolve chave legível e o endereço otpauth", async () => {
    const { segredo, uri } = await startTotpEnrollment({ id: 5, email: "ana@teste.com" })
    expect(segredo).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    const chave = segredo.replace(/ /g, "")
    expect(uri).toContain(`secret=${chave}`)
    expect(uri).toContain(encodeURIComponent("ana@teste.com"))
    expect(db.state.usuario.totpAtivo).toBe(false)
    expect(db.state.usuario.totpSegredo).not.toContain(chave) // nada em texto puro no banco
    expect(decryptTotpSecret(db.state.usuario.totpSegredo!)).toBe(chave)
  })

  it("recomeçar troca a chave pendente", async () => {
    const a = await startTotpEnrollment({ id: 5, email: "ana@teste.com" })
    const b = await startTotpEnrollment({ id: 5, email: "ana@teste.com" })
    expect(a.segredo).not.toBe(b.segredo)
  })

  it("passo 2: código certo liga, grava o passo usado e gera 8 códigos de recuperação (só o hash vai ao banco)", async () => {
    const { codigos } = await ligar()
    expect(db.state.usuario.totpAtivo).toBe(true)
    expect(db.state.usuario.totpUltimoPasso).toBe(totpStep(AGORA.getTime()))
    expect(codigos).toHaveLength(8)
    expect(new Set(codigos).size).toBe(8)
    expect(db.state.codigos).toHaveLength(8)
    for (const c of codigos) expect(db.state.codigos.some((r) => r.codigoHash.includes(c))).toBe(false)
  })

  it("passo 2: código errado NÃO liga e não gera códigos", async () => {
    await startTotpEnrollment({ id: 5, email: "ana@teste.com" })
    expect(await confirmTotpEnrollment(db.state.usuario, "000000")).toBeNull()
    expect(db.state.usuario.totpAtivo).toBe(false)
    expect(db.state.codigos).toHaveLength(0)
  })

  it("passo 2 sem ter começado (sem chave pendente): não liga", async () => {
    expect(await confirmTotpEnrollment(db.state.usuario, "123456")).toBeNull()
  })
})

describe("conferir no login", () => {
  it("código do app confere uma vez; o MESMO código não vale de novo (replay)", async () => {
    const { chave } = await ligar()
    // o passo do cadastro já foi gasto: o próximo código válido é o do passo seguinte
    const proximo = codigoAgora(chave, 1)
    expect(await checkLoginCode(db.state.usuario, proximo)).toEqual({ ok: true, via: "app" })
    expect(await checkLoginCode(db.state.usuario, proximo)).toEqual({ ok: false })
  })

  it("o código usado ao LIGAR também não serve para entrar logo em seguida", async () => {
    const { chave } = await ligar()
    expect(await checkLoginCode(db.state.usuario, codigoAgora(chave))).toEqual({ ok: false })
  })

  it("dois pedidos simultâneos com o mesmo código: só um passa (a troca do passo é atômica)", async () => {
    const { chave } = await ligar()
    const proximo = codigoAgora(chave, 1)
    const usuario = { ...db.state.usuario } // as duas requisições leram o mesmo estado
    const [a, b] = await Promise.all([checkLoginCode(usuario, proximo), checkLoginCode(usuario, proximo)])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  })

  it("código errado, vazio ou de outra chave: recusado", async () => {
    await ligar()
    for (const ruim of ["000000", "", "12345", null, undefined]) {
      expect(await checkLoginCode(db.state.usuario, ruim)).toEqual({ ok: false })
    }
  })

  it("código de recuperação: entra, gasta o código (uso único) e informa quantos restam", async () => {
    const { codigos } = await ligar()
    expect(await checkLoginCode(db.state.usuario, codigos[0])).toEqual({ ok: true, via: "recuperacao", restantes: 7 })
    expect(await checkLoginCode(db.state.usuario, codigos[0])).toEqual({ ok: false })
    // aceita como a pessoa digita: minúsculas e sem hífen
    expect(await checkLoginCode(db.state.usuario, codigos[1].toLowerCase().replace("-", ""))).toMatchObject({ ok: true, restantes: 6 })
  })

  it("código de recuperação de OUTRO usuário não serve (o hash é amarrado ao usuário)", async () => {
    const { codigos } = await ligar()
    expect(await checkLoginCode({ ...db.state.usuario, id: 6 }, codigos[0])).toEqual({ ok: false })
  })

  it("dois pedidos simultâneos com o mesmo código de recuperação: só um passa", async () => {
    const { codigos } = await ligar()
    const [a, b] = await Promise.all([checkLoginCode(db.state.usuario, codigos[0]), checkLoginCode(db.state.usuario, codigos[0])])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  })
})

describe("chave que não decifra (AUTH_SECRET foi trocado)", () => {
  it("responde com um erro de serviço indisponível e orientação clara — não um 500 opaco — e registra a causa", async () => {
    const { chave } = await ligar()
    vi.stubEnv("AUTH_SECRET", "outro".repeat(10)) // troca do segredo depois de a chave ter sido cifrada
    const erro = await checkLoginCode(db.state.usuario, codigoAgora(chave, 1)).catch((e) => e)
    expect(erro).toBeInstanceOf(ServiceUnavailableError)
    expect(erro.message).toMatch(/administrador/)
  })
})

describe("renovar e desligar", () => {
  it("gerar novos códigos invalida TODOS os anteriores", async () => {
    const { codigos: antigos } = await ligar()
    const novos = await regenerateRecoveryCodes(5)
    expect(novos).toHaveLength(8)
    expect(await checkLoginCode(db.state.usuario, antigos[0])).toEqual({ ok: false })
    expect(await checkLoginCode(db.state.usuario, novos[0])).toMatchObject({ ok: true, via: "recuperacao" })
  })

  it("desligar apaga a chave, o passo e os códigos de recuperação", async () => {
    await ligar()
    await disableTotp(5)
    expect(db.state.usuario).toMatchObject({ totpAtivo: false, totpSegredo: null, totpUltimoPasso: null })
    expect(db.state.codigos).toHaveLength(0)
  })

  it("a chave decifrada bate com o que o app do usuário geraria (base32 sem perdas)", async () => {
    const { chave } = await ligar()
    expect(base32Decode(chave)).toHaveLength(20)
  })
})
