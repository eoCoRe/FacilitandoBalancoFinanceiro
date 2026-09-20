import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface Row {
  id: string
  usuarioId: number
  tipo: string
  segredoHash: string
  tentativas: number
  expiraEm: Date
  usadoEm: Date | null
  criadoEm: Date
}

// "Banco" em memória que entende só os filtros que verification.ts usa — o bastante para provar
// uso único, validade e limite de tentativas de verdade, em vez de conferir chamadas mockadas.
const { prisma, rows } = vi.hoisted(() => {
  const rows = new Map<string, Row>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (row: Row, where: any): boolean => {
    if (where.OR) return where.OR.some((w: unknown) => matches(row, w))
    for (const [key, cond] of Object.entries(where)) {
      const value = (row as unknown as Record<string, unknown>)[key]
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as { lt?: number | Date; gt?: number | Date }
        if (c.lt !== undefined && !((value as number | Date) < c.lt)) return false
        if (c.gt !== undefined && !((value as number | Date) > c.gt)) return false
      } else if (value !== cond) return false
    }
    return true
  }

  const prisma = {
    tokenVerificacao: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deleteMany: async ({ where }: any) => {
        for (const [id, row] of rows) if (matches(row, where)) rows.delete(id)
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        rows.set(data.id, { tentativas: 0, usadoEm: null, criadoEm: new Date(), ...data })
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) =>
        [...rows.values()].filter((r) => matches(r, where)).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())[0] ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const row of rows.values()) {
          if (!matches(row, where)) continue
          count++
          if (data.tentativas?.increment) row.tentativas += data.tentativas.increment
          if ("usadoEm" in data) row.usadoEm = data.usadoEm
        }
        return { count }
      },
    },
  }
  return { prisma, rows }
})

vi.mock("@/lib/db", () => ({ prisma }))

import {
  checkCode,
  consumeResetToken,
  createCodeChallenge,
  releaseResetToken,
  createResetToken,
  latestPendingChallengeId,
  MAX_CODE_ATTEMPTS,
  RESET_TTL_MS,
  CODE_TTL_MS,
} from "./verification"

beforeEach(() => {
  rows.clear()
  vi.stubEnv("AUTH_SECRET", "v".repeat(40))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("link de recuperação de senha", () => {
  it("o token confere uma vez e devolve o usuário; segunda vez é recusado (uso único)", async () => {
    const token = await createResetToken(7)
    expect(await consumeResetToken(token)).toBe(7)
    expect(await consumeResetToken(token)).toBeNull()
  })

  it("no banco fica só o hash do segredo, nunca o token nem o segredo", async () => {
    const token = await createResetToken(7)
    const [id, segredo] = token.split(".")
    const row = rows.get(id)!
    expect(row.segredoHash).not.toBe(segredo)
    expect(JSON.stringify(row)).not.toContain(segredo)
  })

  it("recusa segredo adulterado, id inexistente e formatos inválidos", async () => {
    const token = await createResetToken(7)
    const [id] = token.split(".")
    expect(await consumeResetToken(`${id}.segredo-errado`)).toBeNull()
    expect(await consumeResetToken("inexistente.abc")).toBeNull()
    expect(await consumeResetToken(`${token}.extra`)).toBeNull()
    expect(await consumeResetToken("sem-ponto")).toBeNull()
    expect(await consumeResetToken(undefined)).toBeNull()
    expect(await consumeResetToken(12345)).toBeNull()
    // e nada disso queimou o link verdadeiro
    expect(await consumeResetToken(token)).toBe(7)
  })

  it("expira depois do prazo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const token = await createResetToken(7)
    vi.setSystemTime(Date.now() + RESET_TTL_MS + 1000)
    expect(await consumeResetToken(token)).toBeNull()
  })

  it("um novo pedido invalida o link anterior do mesmo usuário, sem tocar nos de outros", async () => {
    const antigo = await createResetToken(7)
    const deOutro = await createResetToken(8)
    const novo = await createResetToken(7)
    expect(await consumeResetToken(antigo)).toBeNull()
    expect(await consumeResetToken(novo)).toBe(7)
    expect(await consumeResetToken(deOutro)).toBe(8)
  })

  it("um código de 2 etapas não serve como link de recuperação", async () => {
    const { id } = await createCodeChallenge(7, "LOGIN_2FA")
    expect(await consumeResetToken(`${id}.qualquer`)).toBeNull()
  })
})

describe("releaseResetToken", () => {
  it("devolve um link já gasto ao estado de 'não usado' (falha ao gravar a senha)", async () => {
    const token = await createResetToken(7)
    expect(await consumeResetToken(token)).toBe(7)
    expect(await consumeResetToken(token)).toBeNull()

    await releaseResetToken(token)

    expect(await consumeResetToken(token)).toBe(7)
  })

  it("ignora entradas inválidas e não mexe em códigos de 2 etapas", async () => {
    await releaseResetToken(undefined)
    await releaseResetToken("")
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    await checkCode(id, 7, "LOGIN_2FA", code)
    await releaseResetToken(`${id}.qualquer`)
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("invalido") // continua gasto
  })
})

describe("código de 6 dígitos", () => {
  it("gera 6 dígitos e guarda só o HMAC (nunca o código)", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    expect(code).toMatch(/^\d{6}$/)
    expect(JSON.stringify(rows.get(id))).not.toContain(code)
  })

  it("o código correto confere uma vez; repetir é recusado (uso único)", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("ok")
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("invalido")
  })

  it("aceita o código com espaços (como o e-mail costuma exibir)", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    expect(await checkCode(id, 7, "LOGIN_2FA", `${code.slice(0, 3)} ${code.slice(3)}`)).toBe("ok")
  })

  it("código errado gasta uma tentativa; ao esgotar 5, bloqueia até o código certo", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    const errado = code === "000000" ? "111111" : "000000"
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) expect(await checkCode(id, 7, "LOGIN_2FA", errado)).toBe("invalido")
    expect(await checkCode(id, 7, "LOGIN_2FA", errado)).toBe("bloqueado")
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("bloqueado")
  })

  it("o limite vale mesmo com chutes em paralelo (a tentativa é reservada antes de comparar)", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    const errado = code === "000000" ? "111111" : "000000"
    await Promise.all(Array.from({ length: 20 }, () => checkCode(id, 7, "LOGIN_2FA", errado)))
    expect(rows.get(id)!.tentativas).toBe(MAX_CODE_ATTEMPTS)
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("bloqueado")
  })

  it("dois envios simultâneos do código certo: só um passa", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    const resultados = await Promise.all([checkCode(id, 7, "LOGIN_2FA", code), checkCode(id, 7, "LOGIN_2FA", code)])
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1)
  })

  it("expira depois do prazo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    vi.setSystemTime(Date.now() + CODE_TTL_MS + 1000)
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("expirado")
  })

  it("não vale para outro usuário nem para outro tipo de desafio", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    expect(await checkCode(id, 8, "LOGIN_2FA", code)).toBe("invalido")
    expect(await checkCode(id, 7, "ATIVACAO_2FA", code)).toBe("invalido")
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("ok")
  })

  it("recusa formato inválido sem gastar tentativa", async () => {
    const { id } = await createCodeChallenge(7, "LOGIN_2FA")
    for (const ruim of ["12345", "1234567", "abcdef", "", undefined, 123456]) {
      expect(await checkCode(id, 7, "LOGIN_2FA", ruim)).toBe("invalido")
    }
    expect(rows.get(id)!.tentativas).toBe(0)
  })

  it("um novo código invalida o anterior do mesmo tipo (reenviar)", async () => {
    const primeiro = await createCodeChallenge(7, "LOGIN_2FA")
    const segundo = await createCodeChallenge(7, "LOGIN_2FA")
    expect(await checkCode(primeiro.id, 7, "LOGIN_2FA", primeiro.code)).toBe("invalido")
    expect(await checkCode(segundo.id, 7, "LOGIN_2FA", segundo.code)).toBe("ok")
  })

  it("o HMAC depende do AUTH_SECRET: com outro segredo o código não confere", async () => {
    const { id, code } = await createCodeChallenge(7, "LOGIN_2FA")
    vi.stubEnv("AUTH_SECRET", "outro-segredo-".padEnd(40, "x"))
    expect(await checkCode(id, 7, "LOGIN_2FA", code)).toBe("invalido")
  })
})

describe("latestPendingChallengeId", () => {
  it("devolve o desafio pendente mais recente, ou null", async () => {
    expect(await latestPendingChallengeId(7, "ATIVACAO_2FA")).toBeNull()
    const { id } = await createCodeChallenge(7, "ATIVACAO_2FA")
    expect(await latestPendingChallengeId(7, "ATIVACAO_2FA")).toBe(id)
    expect(await latestPendingChallengeId(7, "LOGIN_2FA")).toBeNull()
  })
})
