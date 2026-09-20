import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Aqui a selagem roda de verdade (o setup global a troca por um no-op nos outros testes).
vi.unmock("@/lib/server/audit-seal")

type Row = { id: number; empresaId: number; usuario: string; acao: string; detalhe: string; criadoEm: Date; selo: string | null; seloAnterior: string | null }

// Banco de mentira, com estado, só com o que a selagem e a verificação usam.
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[], nextId: 1 }
  type Where = { selo?: null | { not: null }; id?: { gt: number } }
  const match = (r: Row, w: Where = {}) =>
    (w.selo === undefined || (w.selo === null ? r.selo === null : r.selo !== null)) && (w.id === undefined || r.id > w.id.gt)
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    $queryRaw: vi.fn(async () => []),
    auditLog: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => [...state.rows].reverse().find((r) => match(r, where)) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => state.rows.filter((r) => match(r, where)).slice(0, take)),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
        Object.assign(state.rows.find((r) => r.id === where.id)!, data)
      }),
      count: vi.fn(async ({ where }: { where: Where }) => state.rows.filter((r) => match(r, where)).length),
    },
  }
  return { state, prisma }
})
vi.mock("@/lib/db", () => ({ prisma: db.prisma }))

import { computeSeal, sealPending, verifyAuditIntegrity } from "./audit-seal"

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
      ...over,
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", "s".repeat(40))
  vi.stubEnv("AUDIT_SEAL_SECRET", "")
  db.state.rows = []
  db.state.nextId = 1
})
afterEach(() => vi.unstubAllEnvs())

describe("selagem", () => {
  it("sela em ordem de id, encadeando cada registro ao selo do anterior", async () => {
    add(3)
    expect(await sealPending()).toBe(3)
    const [a, b, c] = db.state.rows
    expect(a.seloAnterior).toBeNull()
    expect(b.seloAnterior).toBe(a.selo)
    expect(c.seloAnterior).toBe(b.selo)
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

  it("um histórico grande é selado em lotes", async () => {
    add(450)
    expect(await sealPending()).toBe(450)
    expect(db.prisma.$transaction.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(db.state.rows.every((r) => r.selo !== null)).toBe(true)
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
