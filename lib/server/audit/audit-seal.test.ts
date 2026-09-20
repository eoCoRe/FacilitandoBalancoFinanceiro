import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Aqui a selagem roda de verdade (o setup global a troca por um no-op nos outros testes).
vi.unmock("@/lib/server/audit/audit-seal")

type Row = { id: number; empresaId: number; usuario: string; acao: string; detalhe: string; criadoEm: Date; selo: string | null; seloAnterior: string | null; seloSeq: number | null }

// Banco de mentira, com estado, só com o que a selagem e a verificação usam.
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[], nextId: 1 }
  type Where = { selo?: null | { not: null }; seloSeq?: null | { gt: number }; criadoEm?: { gte?: Date; lt?: Date } }
  type OrderBy = { id?: "asc" | "desc"; seloSeq?: "asc" | "desc" }
  const match = (r: Row, w: Where = {}) =>
    (w.selo === undefined || (w.selo === null ? r.selo === null : r.selo !== null)) &&
    (w.seloSeq === undefined || (w.seloSeq === null ? r.seloSeq === null : r.seloSeq !== null && r.seloSeq > w.seloSeq.gt)) &&
    (w.criadoEm?.gte === undefined || r.criadoEm >= w.criadoEm.gte) &&
    (w.criadoEm?.lt === undefined || r.criadoEm < w.criadoEm.lt)
  const sorted = (rows: Row[], orderBy: OrderBy) => {
    const [key, dir] = Object.entries(orderBy)[0] as ["id" | "seloSeq", "asc" | "desc"]
    return [...rows].sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * (dir === "asc" ? 1 : -1))
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    $queryRaw: vi.fn(async () => []),
    auditLog: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: Where; orderBy: OrderBy }) => sorted(state.rows.filter((r) => match(r, where)), orderBy)[0] ?? null),
      findMany: vi.fn(async ({ where, orderBy, take }: { where: Where; orderBy: OrderBy; take: number }) =>
        sorted(state.rows.filter((r) => match(r, where)), orderBy).slice(0, take),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
        Object.assign(state.rows.find((r) => r.id === where.id)!, data)
      }),
      count: vi.fn(async ({ where }: { where: Where }) => state.rows.filter((r) => match(r, where)).length),
    },
  }
  return { state, prisma }
})
vi.mock("@/lib/db", () => ({ prisma: db.prisma }))

import { computeSeal, SEAL_GRACE_MS, sealPending, verifyAuditIntegrity } from "@/lib/server/audit/audit-seal"

function add(n = 1, over: Partial<Row> = {}) {
  for (let i = 0; i < n; i++) {
    const id = db.state.nextId++
    db.state.rows.push({
      id,
      empresaId: 1,
      usuario: "ana@teste.com",
      acao: `Ação ${id}`,
      detalhe: `Detalhe ${id}`,
      criadoEm: new Date(Date.UTC(2026, 8, 20, 10, 0, id)),
      selo: null,
      seloAnterior: null,
      seloSeq: null,
      ...over,
    })
  }
}

// "Agora" fixo, poucos minutos depois dos registros criados por add(): eles contam como recentes.
const AGORA = new Date("2026-09-20T10:05:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AGORA)
  vi.stubEnv("AUTH_SECRET", "s".repeat(40))
  vi.stubEnv("AUDIT_SEAL_SECRET", "")
  db.state.rows = []
  db.state.nextId = 1
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("selagem", () => {
  it("sela em ordem de id, encadeando cada registro ao selo do anterior", async () => {
    add(3)
    expect(await sealPending()).toBe(3)
    const [a, b, c] = db.state.rows
    expect(a.seloAnterior).toBeNull()
    expect(b.seloAnterior).toBe(a.selo)
    expect(c.seloAnterior).toBe(b.selo)
    expect([a.seloSeq, b.seloSeq, c.seloSeq]).toEqual([1, 2, 3])
    expect(a.selo).toBe(computeSeal(null, a))
    expect(new Set(db.state.rows.map((r) => r.selo)).size).toBe(3)
  })

  it("só sela o que falta; chamar de novo não muda nada", async () => {
    add(2)
    await sealPending()
    const antes = db.state.rows.map((r) => r.selo)
    expect(await sealPending()).toBe(0)
    add(1)
    expect(await sealPending()).toBe(1)
    expect(db.state.rows.slice(0, 2).map((r) => r.selo)).toEqual(antes)
    expect(db.state.rows[2].seloAnterior).toBe(antes[1])
  })

  it("toma a trava do banco antes de selar (duas requisições não bifurcam a cadeia)", async () => {
    add(1)
    await sealPending()
    expect(db.prisma.$queryRaw).toHaveBeenCalled()
  })

  it("um histórico grande é selado em lotes, cada um com tempo folgado (o padrão de 5 s abortaria num banco lento)", async () => {
    add(450)
    expect(await sealPending()).toBe(450)
    expect(db.prisma.$transaction.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(db.state.rows.every((r) => r.selo !== null)).toBe(true)
    for (const call of db.prisma.$transaction.mock.calls as unknown[][]) {
      expect((call[1] as { timeout: number }).timeout).toBeGreaterThanOrEqual(20_000)
    }
  })

  it("registro confirmado ATRASADO (id menor, mas só apareceu depois de um mais novo já selado) também é selado, no fim da cadeia", async () => {
    add(6)
    const atrasado = db.state.rows.splice(3, 1)[0] // o #4 ainda não foi confirmado quando #5 e #6 foram selados
    expect(await sealPending()).toBe(5)
    db.state.rows.splice(3, 0, atrasado) // agora ele aparece
    expect(await sealPending()).toBe(1)

    const [ultimoSeq] = [...db.state.rows].map((r) => r.seloSeq!).sort((a, b) => b - a)
    expect(atrasado.seloSeq).toBe(ultimoSeq) // entrou no fim
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 6, naoSelados: 0 })
  })

  it("o selo depende de TODOS os campos e do selo anterior", () => {
    const base = { id: 1, empresaId: 1, usuario: "a@b.com", acao: "x", detalhe: "y", criadoEm: new Date("2026-01-01T00:00:00Z") }
    const selo = computeSeal(null, base)
    expect(selo).toMatch(/^[0-9a-f]{64}$/)
    for (const mudanca of [{ id: 2 }, { empresaId: 2 }, { usuario: "c@d.com" }, { acao: "z" }, { detalhe: "w" }, { criadoEm: new Date("2026-01-01T00:00:01Z") }]) {
      expect(computeSeal(null, { ...base, ...mudanca })).not.toBe(selo)
    }
    expect(computeSeal("outro-selo", base)).not.toBe(selo)
  })

  it("com outra chave o selo é outro (quem só tem o banco não refaz a cadeia)", () => {
    const row = { id: 1, empresaId: 1, usuario: "a", acao: "b", detalhe: "c", criadoEm: new Date(0) }
    const comAuth = computeSeal(null, row)
    vi.stubEnv("AUDIT_SEAL_SECRET", "z".repeat(40))
    expect(computeSeal(null, row)).not.toBe(comAuth)
  })

  it("AUDIT_SEAL_SECRET curta é recusada (falha fechado)", () => {
    vi.stubEnv("AUDIT_SEAL_SECRET", "curta")
    expect(() => computeSeal(null, { id: 1, empresaId: 1, usuario: "a", acao: "b", detalhe: "c", criadoEm: new Date(0) })).toThrow(/AUDIT_SEAL_SECRET/)
  })
})

describe("prazo para selar (quem tem só o banco não pode fazer o servidor carimbar uma adulteração)", () => {
  const passaTempo = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

  it("registro SEM selo e velho demais NÃO é selado: a verificação aponta", async () => {
    add(3)
    await sealPending()
    add(1, { criadoEm: new Date(AGORA.getTime() - 2 * 3600_000) }) // criado há 2 h e nunca selado
    expect(await sealPending()).toBe(0)
    expect(db.state.rows[3].selo).toBeNull()

    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, motivo: expect.stringContaining("sem selo há mais de 15 minutos") })
  })

  it("ATAQUE: zerar selo/posição do fim da trilha e alterar o conteúdo — depois do prazo não vira 'íntegra'", async () => {
    add(5)
    await sealPending()
    passaTempo(SEAL_GRACE_MS + 60_000)
    for (const linha of db.state.rows.slice(3)) {
      linha.selo = null
      linha.seloAnterior = null
      linha.seloSeq = null
      linha.detalhe = "adulterado"
    }
    expect(await sealPending()).toBe(0) // o servidor NÃO carimba a adulteração
    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(4)
  })

  it("ação explícita do administrador (ignoreGrace): sela também os velhos e a verificação volta a ficar íntegra", async () => {
    add(3)
    await sealPending()
    add(1, { criadoEm: new Date(AGORA.getTime() - 2 * 3600_000) }) // ficou 2 h sem selo (falha passageira de selagem)
    expect(await sealPending()).toBe(0)
    expect((await verifyAuditIntegrity()).integra).toBe(false)

    expect(await sealPending({ ignoreGrace: true })).toBe(1)
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 4, naoSelados: 0 })
  })

  it("registro recente sem selo (acabou de ser gravado) é selado normalmente", async () => {
    add(2)
    await sealPending()
    add(1)
    expect(await sealPending()).toBe(1)
  })

  it("trilha SEM NENHUM selo e histórico velho (instalação anterior): o servidor NÃO sela sozinho — a verificação aponta e o administrador sela uma vez", async () => {
    add(4, { criadoEm: new Date("2025-01-01T00:00:00Z") })
    expect(await sealPending()).toBe(0)
    const antes = await verifyAuditIntegrity()
    expect(antes.integra).toBe(false)
    expect(antes.quebra).toMatchObject({ id: 1, motivo: expect.stringContaining("sem selo há mais de 15 minutos") })

    expect(await sealPending({ ignoreGrace: true })).toBe(4)
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 4, naoSelados: 0 })
  })

  it("ATAQUE: zerar os selos de TODA a trilha e editar — antes não havia selo nenhum a defender, e o servidor carimbava tudo", async () => {
    add(5)
    await sealPending()
    passaTempo(SEAL_GRACE_MS + 60_000)
    for (const linha of db.state.rows) {
      linha.selo = null
      linha.seloAnterior = null
      linha.seloSeq = null
    }
    db.state.rows[1].detalhe = "adulterado"
    expect(await sealPending()).toBe(0) // o servidor NÃO recria os selos
    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(1)
  })

  it("trilha nova (nenhum selo, registros recentes): selados normalmente — instalação nova não precisa de ação nenhuma", async () => {
    add(3)
    expect(await sealPending()).toBe(3)
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 3 })
  })

  it("vale também para o registro atrasado: se confirmar dentro do prazo, entra na cadeia", async () => {
    add(3)
    const atrasado = db.state.rows.splice(1, 1)[0]
    await sealPending()
    db.state.rows.splice(1, 0, atrasado)
    expect(await sealPending()).toBe(1)
  })
})

describe("verificação", () => {
  it("trilha intacta: íntegra, com a contagem e a faixa de ids", async () => {
    add(5)
    const r = await verifyAuditIntegrity()
    expect(r).toEqual({ integra: true, verificados: 5, naoSelados: 0, primeiroId: 1, ultimoId: 5, quebra: null })
  })

  it("trilha vazia: íntegra, nada a conferir", async () => {
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 0, primeiroId: null })
  })

  it.each([
    ["ação", { acao: "Ação adulterada" }],
    ["detalhe", { detalhe: "Ninguém fez nada aqui" }],
    ["usuário", { usuario: "outra@pessoa.com" }],
    ["data", { criadoEm: new Date("2020-01-01T00:00:00Z") }],
  ])("editar o %s de um registro é detectado, apontando o registro", async (_campo, mudanca) => {
    add(5)
    await sealPending()
    Object.assign(db.state.rows[2], mudanca) // o registro #3
    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 3, motivo: expect.stringContaining("alterado") })
    expect(r.verificados).toBe(2) // conferiu #1 e #2 antes de achar o problema
  })

  it("apagar um registro do MEIO quebra o encadeamento no seguinte", async () => {
    add(5)
    await sealPending()
    db.state.rows.splice(2, 1) // some o #3
    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, motivo: expect.stringContaining("encadeamento") })
  })

  it("inserir um registro forjado no meio também é detectado", async () => {
    add(4)
    await sealPending()
    db.state.rows.splice(2, 0, { ...db.state.rows[1], id: 99, selo: "0".repeat(64) })
    expect((await verifyAuditIntegrity()).integra).toBe(false)
  })

  it("tirar só a POSIÇÃO de um registro selado não o esconde da verificação", async () => {
    add(4)
    await sealPending()
    db.state.rows[3].seloSeq = null // o último: sumiria da leitura por posição, mas continua com selo
    const r = await verifyAuditIntegrity()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, motivo: expect.stringContaining("posição") })
  })

  it("tirar a posição de um registro do MEIO quebra o encadeamento no seguinte", async () => {
    add(4)
    await sealPending()
    db.state.rows[1].seloSeq = null
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: false, quebra: { id: 3 } })
  })

  it("trocar o selo por um inventado não passa (sem a chave não dá para calcular)", async () => {
    add(3)
    await sealPending()
    db.state.rows[1].selo = "f".repeat(64)
    expect((await verifyAuditIntegrity()).integra).toBe(false)
  })

  it("o expurgo por retenção (apaga os MAIS ANTIGOS) não é tratado como adulteração", async () => {
    add(6)
    await sealPending()
    db.state.rows.splice(0, 3) // sobram #4..#6; o #4 aponta para um selo que não existe mais
    const r = await verifyAuditIntegrity()
    expect(r).toMatchObject({ integra: true, verificados: 3, primeiroId: 4, ultimoId: 6 })
  })

  it("mas adulterar o primeiro que sobrou depois do expurgo continua sendo detectado", async () => {
    add(6)
    await sealPending()
    db.state.rows.splice(0, 3)
    db.state.rows[0].acao = "outra"
    expect((await verifyAuditIntegrity()).quebra).toMatchObject({ id: 4 })
  })

  it("selo trocado de chave (AUTH_SECRET/AUDIT_SEAL_SECRET mudou) aparece como problema, não some", async () => {
    add(3)
    await sealPending()
    vi.stubEnv("AUDIT_SEAL_SECRET", "novo".repeat(10))
    expect((await verifyAuditIntegrity()).integra).toBe(false)
  })

  it("registros gravados depois são selados na própria verificação", async () => {
    add(2)
    await sealPending()
    add(2)
    const r = await verifyAuditIntegrity()
    expect(r).toMatchObject({ integra: true, verificados: 4, naoSelados: 0 })
  })

  it("confere trilhas maiores que uma página de leitura", async () => {
    add(2300)
    expect(await verifyAuditIntegrity()).toMatchObject({ integra: true, verificados: 2300 })
  })
})
