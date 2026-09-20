import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Aqui a selagem roda de verdade (o setup global a troca por um no-op nos outros testes).
vi.unmock("@/lib/server/audit/audit-seal")

type Row = { id: number; empresaId: number; usuario: string; acao: string; detalhe: string; criadoEm: Date; selo: string | null; seloAnterior: string | null; seloSeq: number | null }

// Banco de mentira, com estado, só com o que a selagem e a verificação usam — inclusive a regra do Postgres de que
// ORDER BY ... DESC põe NULL primeiro (e ASC, por último), que um mock ingênuo esconderia.
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[], nextId: 1, falhaTransacao: false }
  type Where = {
    selo?: null | { not: null }
    seloSeq?: null | { not: null } | { gt: number }
    id?: { in: number[] }
    criadoEm?: { gte?: Date; lt?: Date }
  }
  type OrderBy = { id?: "asc" | "desc"; seloSeq?: "asc" | "desc" }
  const match = (r: Row, w: Where = {}) => {
    if (w.selo !== undefined && (w.selo === null ? r.selo !== null : r.selo === null)) return false
    if (w.seloSeq !== undefined) {
      if (w.seloSeq === null) {
        if (r.seloSeq !== null) return false
      } else if ("not" in w.seloSeq) {
        if (r.seloSeq === null) return false
      } else if (r.seloSeq === null || r.seloSeq <= w.seloSeq.gt) return false
    }
    if (w.id !== undefined && !w.id.in.includes(r.id)) return false
    if (w.criadoEm?.gte !== undefined && r.criadoEm < w.criadoEm.gte) return false
    if (w.criadoEm?.lt !== undefined && r.criadoEm >= w.criadoEm.lt) return false
    return true
  }
  const sorted = (rows: Row[], orderBy: OrderBy) => {
    const [key, dir] = Object.entries(orderBy)[0] as ["id" | "seloSeq", "asc" | "desc"]
    return [...rows].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (x === y) return 0
      if (x === null) return dir === "asc" ? 1 : -1 // NULLS LAST no ASC, NULLS FIRST no DESC
      if (y === null) return dir === "asc" ? -1 : 1
      return (x - y) * (dir === "asc" ? 1 : -1)
    })
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) => {
      // A falha simulada é a das transações de SELAGEM; a leitura da verificação (instantâneo) segue funcionando.
      if (state.falhaTransacao && !options?.isolationLevel) throw new Error("banco indisponível")
      return fn(prisma)
    }),
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

import { computeSeal, contentFingerprint, resetOwnUnsealed, sealOwn, sealPending, sealPendingDetailed, verifyAuditIntegrity } from "@/lib/server/audit/audit-seal"

// "Agora" fixo, poucos minutos depois dos registros criados por add().
const AGORA = new Date("2026-09-20T10:05:00Z")

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
// A ação explícita do administrador (ou a preparação de um cenário): sela todos os pendentes.
const selarTodos = () => sealPending({ all: true })
// O servidor sela o registro que ACABOU de gravar: aqui, o que está na "tabela" naquele momento.
const sealOwnId = (id: number) => sealOwn(db.state.rows.find((r) => r.id === id)!)
// Sem a espera de 1,5 s da verificação (nos testes a espera é zero, salvo o que testa a espera de propósito).
const verificar = (opcoes: { settleMs?: number } = {}) => verifyAuditIntegrity({ settleMs: 0, ...opcoes })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AGORA)
  vi.stubEnv("AUTH_SECRET", "s".repeat(40))
  vi.stubEnv("AUDIT_SEAL_SECRET", "")
  db.state.rows = []
  db.state.nextId = 1
  db.state.falhaTransacao = false
  resetOwnUnsealed()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("selagem", () => {
  it("sela em ordem de id, encadeando cada registro ao selo do anterior", async () => {
    add(3)
    expect(await selarTodos()).toBe(3)
    const [a, b, c] = db.state.rows
    expect(a.seloAnterior).toBeNull()
    expect(b.seloAnterior).toBe(a.selo)
    expect(c.seloAnterior).toBe(b.selo)
    expect([a.seloSeq, b.seloSeq, c.seloSeq]).toEqual([1, 2, 3])
    expect(a.selo).toBe(computeSeal(null, 1, a))
    expect(new Set(db.state.rows.map((r) => r.selo)).size).toBe(3)
  })

  it("sem ids e sem 'all' não faz nada (nem abre transação): o servidor nunca sela 'o que estiver pendente' por conta própria", async () => {
    add(3)
    expect(await sealPending()).toBe(0)
    expect(await sealPending({ ids: [] })).toBe(0)
    expect(db.prisma.$transaction).not.toHaveBeenCalled()
    expect(db.state.rows.every((r) => r.selo === null)).toBe(true)
  })

  it("com ids, sela SÓ esses registros; os demais continuam sem selo", async () => {
    add(5)
    expect(await sealPending({ ids: [2, 4] })).toBe(2)
    expect(db.state.rows.map((r) => r.selo !== null)).toEqual([false, true, false, true, false])
    expect(db.state.rows[1].seloSeq).toBe(1)
    expect(db.state.rows[3].seloSeq).toBe(2)
  })

  it("só sela o que falta; chamar de novo não muda nada", async () => {
    add(2)
    await selarTodos()
    const antes = db.state.rows.map((r) => r.selo)
    expect(await selarTodos()).toBe(0)
    add(1)
    expect(await selarTodos()).toBe(1)
    expect(db.state.rows.slice(0, 2).map((r) => r.selo)).toEqual(antes)
    expect(db.state.rows[2].seloAnterior).toBe(antes[1])
  })

  it("toma a trava do banco antes de selar (duas requisições não bifurcam a cadeia)", async () => {
    add(1)
    await selarTodos()
    expect(db.prisma.$queryRaw).toHaveBeenCalled()
  })

  it("um histórico grande é selado em lotes, cada um com tempo folgado (o padrão de 5 s abortaria num banco lento)", async () => {
    add(450)
    expect(await selarTodos()).toBe(450)
    expect(db.prisma.$transaction.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(db.state.rows.every((r) => r.selo !== null)).toBe(true)
    for (const call of db.prisma.$transaction.mock.calls as unknown[][]) {
      expect((call[1] as { timeout: number }).timeout).toBeGreaterThanOrEqual(20_000)
    }
  })

  it("registro confirmado ATRASADO (id menor, mas só apareceu depois de um mais novo já selado) entra no fim da cadeia", async () => {
    add(6)
    const atrasado = db.state.rows.splice(3, 1)[0] // o #4 ainda não foi confirmado quando os outros foram selados
    await sealPending({ ids: [1, 2, 3, 5, 6] })
    db.state.rows.splice(3, 0, atrasado) // agora ele aparece
    expect(await sealPending({ ids: [4] })).toBe(1)

    expect(atrasado.seloSeq).toBe(6) // entrou no fim
    expect(await verificar()).toMatchObject({ integra: true, verificados: 6, naoSelados: 0 })
  })

  it("registro selado SEM posição não vira o 'último' da cadeia (no Postgres, ORDER BY DESC põe NULL primeiro)", async () => {
    add(3)
    await selarTodos()
    db.state.rows[0].seloSeq = null // sumiu só a posição do #1
    add(1)
    await selarTodos()
    const novo = db.state.rows[3]
    expect(novo.seloAnterior).toBe(db.state.rows[2].selo) // encadeou no #3, o último COM posição
    expect(novo.seloSeq).toBe(4) // e continuou a numeração de onde ela estava (3 → 4), sem recomeçar em 1
  })

  it("o selo depende de TODOS os campos, da POSIÇÃO e do selo anterior", () => {
    const base = { id: 1, empresaId: 1, usuario: "a@b.com", acao: "x", detalhe: "y", criadoEm: new Date("2026-01-01T00:00:00Z") }
    const selo = computeSeal(null, 1, base)
    expect(selo).toMatch(/^[0-9a-f]{64}$/)
    for (const mudanca of [{ id: 2 }, { empresaId: 2 }, { usuario: "c@d.com" }, { acao: "z" }, { detalhe: "w" }, { criadoEm: new Date("2026-01-01T00:00:01Z") }]) {
      expect(computeSeal(null, 1, { ...base, ...mudanca })).not.toBe(selo)
    }
    expect(computeSeal("outro-selo", 1, base)).not.toBe(selo)
    expect(computeSeal(null, 2, base)).not.toBe(selo) // a posição também vale (não dá para trocar selo_seq sem quebrar o selo)
  })

  it("com outra chave o selo é outro (quem só tem o banco não refaz a cadeia)", () => {
    const row = { id: 1, empresaId: 1, usuario: "a", acao: "b", detalhe: "c", criadoEm: new Date(0) }
    const comAuth = computeSeal(null, 1, row)
    vi.stubEnv("AUDIT_SEAL_SECRET", "z".repeat(40))
    expect(computeSeal(null, 1, row)).not.toBe(comAuth)
  })

  it("AUDIT_SEAL_SECRET curta é recusada (falha fechado)", () => {
    vi.stubEnv("AUDIT_SEAL_SECRET", "curta")
    expect(() => computeSeal(null, 1, { id: 1, empresaId: 1, usuario: "a", acao: "b", detalhe: "c", criadoEm: new Date(0) })).toThrow(/AUDIT_SEAL_SECRET/)
  })

  it("a trava do banco é tomada DENTRO da transação e ANTES de ler o último selo", async () => {
    add(2)
    await selarTodos()
    const trava = db.prisma.$queryRaw.mock.invocationCallOrder[0]
    const primeiraLeitura = db.prisma.auditLog.findFirst.mock.invocationCallOrder[0]
    expect(trava).toBeLessThan(primeiraLeitura)
    expect(db.prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(trava)
  })

  it("devolve a faixa de ids REALMENTE selados (o que a ação do administrador registra na trilha)", async () => {
    add(6)
    db.state.rows[0].selo = "x".repeat(64) // o #1 já estava selado: fora do resultado
    db.state.rows[0].seloSeq = 1
    db.state.rows[0].seloAnterior = null
    Object.assign(db.state.rows[0], { selo: computeSeal(null, 1, db.state.rows[0]) })
    expect(await sealPendingDetailed({ all: true })).toEqual({ count: 5, primeiroId: 2, ultimoId: 6 })
    expect(await sealPendingDetailed({ all: true })).toEqual({ count: 0, primeiroId: null, ultimoId: null })
  })

  it("SUSPENDE a selagem se o último registro da cadeia foi mexido (não se apoia num elo adulterado)", async () => {
    add(3)
    await selarTodos()
    db.state.rows[2].detalhe = "adulterado"
    add(1)
    await expect(sealPending({ all: true })).rejects.toThrow(/suspensa/)
    expect(db.state.rows[3].selo).toBeNull()
  })

  it("selo_seq perto do limite do Int4: para com erro claro em vez de estourar no meio do lote", async () => {
    add(1)
    await selarTodos()
    db.state.rows[0].seloSeq = 2_000_000_000
    db.state.rows[0].selo = computeSeal(null, 2_000_000_000, db.state.rows[0])
    add(1)
    await expect(sealPending({ all: true })).rejects.toThrow(/limite/)
  })
})

describe("sealOwn: o servidor só sela o que ELE gravou", () => {
  it("sela o registro que acabou de gravar", async () => {
    add(1)
    await sealOwnId(1)
    expect(db.state.rows[0].selo).not.toBeNull()
  })

  it("NÃO sela registros que ele não gravou, mesmo pendentes e recentes (quem tem só o banco não consegue fazê-lo carimbar)", async () => {
    add(3)
    await sealOwnId(1)
    await sealOwnId(2)
    await sealOwnId(3)
    // quem tem acesso só ao banco zera os selos do fim e edita o conteúdo — e um registro NOVO é gravado em seguida
    for (const linha of db.state.rows.slice(1)) {
      linha.selo = null
      linha.seloAnterior = null
      linha.seloSeq = null
      linha.detalhe = "adulterado"
    }
    add(1)
    await sealOwnId(4)

    expect(db.state.rows.map((r) => r.selo !== null)).toEqual([true, false, false, true]) // só o #4 (dele) foi selado
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(2)
  })

  it("mesmo com a data do registro reescrita (agora ou FUTURA), não carimba o que não gravou — a data não decide nada", async () => {
    add(3)
    await sealOwnId(1)
    for (const criadoEm of [new Date(), new Date(Date.now() + 365 * 86_400_000)]) {
      const alvo = db.state.rows[1]
      Object.assign(alvo, { selo: null, seloAnterior: null, seloSeq: null, detalhe: "adulterado", criadoEm })
      await sealOwnId(3)
      expect(alvo.selo).toBeNull()
    }
  })

  it("conteúdo ALTERADO entre a gravação e a selagem (falha de selagem + edição no banco): o servidor NÃO sela — não vira testemunha do que não gravou", async () => {
    add(2)
    await selarTodos() // uma cadeia existente
    add(1)
    db.state.falhaTransacao = true
    await expect(sealOwnId(3)).rejects.toThrow() // a selagem falhou; o id e a impressão do conteúdo ficaram na memória
    db.state.rows[2].detalhe = "adulterado durante a falha" // quem tem acesso ao banco edita o registro pendente
    db.state.falhaTransacao = false

    add(1)
    await sealOwnId(4) // a próxima gravação tenta selar o #3 de novo — e recusa
    expect(db.state.rows[2].selo).toBeNull()
    expect(db.state.rows[3].selo).not.toBeNull() // o #4 (intacto) é selado normalmente
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 3, tipo: "sem-selo" })
  })

  it("a impressão do conteúdo depende de todos os campos", () => {
    const base = { id: 1, empresaId: 1, usuario: "a", acao: "b", detalhe: "c", criadoEm: new Date(0) }
    const f = contentFingerprint(base)
    for (const mudanca of [{ id: 2 }, { usuario: "z" }, { acao: "z" }, { detalhe: "z" }, { criadoEm: new Date(1) }]) {
      expect(contentFingerprint({ ...base, ...mudanca })).not.toBe(f)
    }
  })

  it("se a selagem falhar, o id fica guardado e a PRÓXIMA gravação sela os dois", async () => {
    add(2)
    db.state.falhaTransacao = true
    await expect(sealOwnId(1)).rejects.toThrow("banco indisponível")
    expect(db.state.rows[0].selo).toBeNull()

    db.state.falhaTransacao = false
    await sealOwnId(2)
    expect(db.state.rows.map((r) => r.selo !== null)).toEqual([true, true])
    expect(await verificar()).toMatchObject({ integra: true, verificados: 2 })
  })

  it("depois do sucesso o id sai da lista: a próxima chamada não repete trabalho", async () => {
    add(2)
    await sealOwnId(1)
    db.prisma.$transaction.mockClear()
    await sealOwnId(2)
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1) // um lote só, sem reprocessar o #1
  })

  it("guarda no máximo os 1000 ids mais recentes quando a selagem falha por muito tempo (a memória não cresce sem limite)", async () => {
    db.state.falhaTransacao = true
    add(1005)
    for (let id = 1; id <= 1005; id++) await sealOwnId(id).catch(() => {})
    db.state.falhaTransacao = false
    db.prisma.$transaction.mockClear()
    await sealOwnId(1005)
    // os 5 mais antigos foram descartados da lista; os 1000 restantes são selados (em lotes de 100)
    expect(db.state.rows.filter((r) => r.selo !== null)).toHaveLength(1000)
    expect(db.state.rows.slice(0, 5).every((r) => r.selo === null)).toBe(true)
  })
})

describe("verificação", () => {
  it("trilha intacta: íntegra, com a contagem e a faixa de ids", async () => {
    add(5)
    await selarTodos()
    expect(await verificar()).toEqual({ integra: true, verificados: 5, naoSelados: 0, primeiroId: 1, ultimoId: 5, quebra: null })
  })

  it("trilha vazia: íntegra, nada a conferir", async () => {
    expect(await verificar()).toMatchObject({ integra: true, verificados: 0, primeiroId: null })
  })

  it("a verificação NÃO sela nada", async () => {
    add(2)
    await verificar()
    expect(db.state.rows.every((r) => r.selo === null)).toBe(true)
    expect(db.prisma.auditLog.update).not.toHaveBeenCalled()
  })

  it.each([
    ["ação", { acao: "Ação adulterada" }],
    ["detalhe", { detalhe: "Ninguém fez nada aqui" }],
    ["usuário", { usuario: "outra@pessoa.com" }],
    ["data", { criadoEm: new Date("2020-01-01T00:00:00Z") }],
  ])("editar o %s de um registro é detectado, apontando o registro", async (_campo, mudanca) => {
    add(5)
    await selarTodos()
    Object.assign(db.state.rows[2], mudanca) // o registro #3
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 3, motivo: expect.stringContaining("alterado") })
    expect(r.verificados).toBe(2) // conferiu #1 e #2 antes de achar o problema
  })

  it("apagar um registro do MEIO quebra o encadeamento no seguinte", async () => {
    add(5)
    await selarTodos()
    db.state.rows.splice(2, 1) // some o #3
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, tipo: "encadeamento", motivo: expect.stringContaining("encadeamento") })
  })

  it("inserir um registro forjado no meio também é detectado", async () => {
    add(4)
    await selarTodos()
    db.state.rows.splice(2, 0, { ...db.state.rows[1], id: 99, selo: "0".repeat(64) })
    expect((await verificar()).integra).toBe(false)
  })

  it("tirar só a POSIÇÃO de um registro selado não o esconde da verificação", async () => {
    add(4)
    await selarTodos()
    db.state.rows[3].seloSeq = null // o último: sumiria da leitura por posição, mas continua com selo
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, tipo: "posicao", motivo: expect.stringContaining("posição") })
  })

  it("tirar a posição de um registro do MEIO quebra o encadeamento no seguinte", async () => {
    add(4)
    await selarTodos()
    db.state.rows[1].seloSeq = null
    expect(await verificar()).toMatchObject({ integra: false, quebra: { id: 3 } })
  })

  it("ATAQUE: posição (selo_seq) NEGATIVA ou zero num registro editado — a leitura começa do mínimo, então ele é visitado e o selo (que cobre a posição) não confere", async () => {
    add(4)
    await selarTodos()
    db.state.rows[3].detalhe = "adulterado"
    db.state.rows[3].seloSeq = -1
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(4)
  })

  it("ATAQUE: posição REPETIDA num registro (sem a chave não dá para refazer o selo dele) — é apontado", async () => {
    add(4)
    await selarTodos()
    db.state.rows[3].seloSeq = db.state.rows[2].seloSeq // #4 com a mesma posição do #3
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(4)
  })

  it("posições repetidas que a leitura por 'maior que' pularia entre páginas: a contagem de selados não bate e a verificação aponta", async () => {
    add(1001)
    await selarTodos()
    // o #1001 ganha a posição do #1000, e o #1000 a do #1001 (ordem trocada): na 1ª página entram os dois primeiros 1000 por posição
    // — para simular o "pulo", duplica a posição do último da página no seguinte
    db.state.rows[1000].seloSeq = db.state.rows[999].seloSeq
    const r = await verificar()
    expect(r.integra).toBe(false)
  })

  it("trocar a posição de um registro selado (sem a chave não dá para refazer o selo) é apontado", async () => {
    add(3)
    await selarTodos()
    db.state.rows[1].seloSeq = 50
    expect((await verificar()).integra).toBe(false)
  })

  it("a cadeia é lida de um INSTANTÂNEO (REPEATABLE READ): um expurgo no meio das páginas não vira falso alarme", async () => {
    add(3)
    await selarTodos()
    await verificar()
    const chamada = (db.prisma.$transaction.mock.calls as unknown[][]).at(-1)!
    expect((chamada[1] as { isolationLevel: string }).isolationLevel).toBe("RepeatableRead")
  })

  it("trocar o selo por um inventado não passa (sem a chave não dá para calcular)", async () => {
    add(3)
    await selarTodos()
    db.state.rows[1].selo = "f".repeat(64)
    expect((await verificar()).integra).toBe(false)
  })

  it("o expurgo por retenção (apaga o COMEÇO da cadeia) não é tratado como adulteração", async () => {
    add(6)
    await selarTodos()
    db.state.rows.splice(0, 3) // sobram #4..#6; o #4 aponta para um selo que não existe mais
    expect(await verificar()).toMatchObject({ integra: true, verificados: 3, primeiroId: 4, ultimoId: 6 })
  })

  it("mas adulterar o primeiro que sobrou depois do expurgo continua sendo detectado", async () => {
    add(6)
    await selarTodos()
    db.state.rows.splice(0, 3)
    db.state.rows[0].acao = "outra"
    expect((await verificar()).quebra).toMatchObject({ id: 4 })
  })

  it("selo trocado de chave (AUTH_SECRET/AUDIT_SEAL_SECRET mudou) aparece como problema, não some", async () => {
    add(3)
    await selarTodos()
    vi.stubEnv("AUDIT_SEAL_SECRET", "novo".repeat(10))
    expect((await verificar()).integra).toBe(false)
  })

  it("confere trilhas maiores que uma página de leitura", async () => {
    add(2300)
    await selarTodos()
    expect(await verificar()).toMatchObject({ integra: true, verificados: 2300 })
  })
})

describe("registros sem selo (a DATA do registro não decide nada: só a espera e a origem)", () => {
  it("um registro gravado por OUTRO servidor e selado durante a espera da verificação não é problema", async () => {
    add(3)
    await selarTodos()
    add(1) // outro servidor acabou de gravar o #4 e ainda não selou
    const verificacao = verificar({ settleMs: 40 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await sealPending({ ids: [4] }) // o outro servidor termina de selar
    expect(await verificacao).toMatchObject({ integra: true, naoSelados: 0 }) // (a cadeia foi lida antes de o #4 ser selado: ele entra na próxima)
  })

  it("continua sem selo depois da espera: é problema, mesmo recém-gravado", async () => {
    add(3)
    await selarTodos()
    add(1, { criadoEm: new Date() })
    const r = await verificar({ settleMs: 10 })
    expect(r.integra).toBe(false)
    expect(r.quebra).toMatchObject({ id: 4, tipo: "sem-selo", motivo: expect.stringContaining("sem selo") })
    expect(db.state.rows[3].selo).toBeNull() // e a verificação não o selou
  })

  it("ATAQUE: registro sem selo com data FUTURA (ou 'agora') para se esconder atrás da tolerância — é apontado do mesmo jeito", async () => {
    add(3)
    await selarTodos()
    const alvo = db.state.rows[2]
    Object.assign(alvo, { selo: null, seloAnterior: null, seloSeq: null, detalhe: "adulterado", criadoEm: new Date(Date.now() + 30 * 86_400_000) })
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(3)
  })

  it("ATAQUE: zerar os selos de TODA a trilha e editar — nada é carimbado, e a verificação aponta", async () => {
    add(5)
    await selarTodos()
    for (const linha of db.state.rows) {
      linha.selo = null
      linha.seloAnterior = null
      linha.seloSeq = null
    }
    db.state.rows[1].detalhe = "adulterado"
    add(1)
    await sealOwnId(6) // o servidor grava e sela SÓ o dele
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(1)
  })

  it("falha PASSAGEIRA de selagem: a verificação repete a selagem do que este processo gravou — sem falso alarme e sem o administrador", async () => {
    add(3)
    await selarTodos()
    add(1)
    db.state.falhaTransacao = true
    await expect(sealOwnId(4)).rejects.toThrow()
    db.state.falhaTransacao = false // o banco voltou, ninguém mais gravou nada no meio tempo

    expect(await verificar()).toMatchObject({ integra: true, verificados: 4, naoSelados: 0 })
  })

  it("se o retry da própria verificação também falhar, o registro aparece como sem selo (a verdade), sem quebrar a verificação", async () => {
    add(2)
    await selarTodos()
    add(1)
    db.state.falhaTransacao = true
    await expect(sealOwnId(3)).rejects.toThrow()
    const r = await verificar()
    expect(r.integra).toBe(false)
    expect(r.quebra?.id).toBe(3)
  })

  it("selagem perdida com o reinício do servidor (o id sumiu da memória): a verificação aponta e o administrador sela", async () => {
    add(3)
    await selarTodos()
    add(1)
    resetOwnUnsealed() // o processo reiniciou
    expect((await verificar()).integra).toBe(false)
    await selarTodos()
    expect(await verificar()).toMatchObject({ integra: true, verificados: 4 })
  })

  it("instalação anterior à selagem (histórico sem selo): apontado até o administrador selar UMA vez; depois íntegra", async () => {
    add(4, { criadoEm: new Date("2025-01-01T00:00:00Z") })
    expect(await sealPending()).toBe(0) // o servidor não sela histórico por conta própria
    const antes = await verificar()
    expect(antes.integra).toBe(false)
    expect(antes.quebra).toMatchObject({ id: 1, motivo: expect.stringContaining("sem selo") })

    expect(await selarTodos()).toBe(4) // decisão do administrador (rota selar-pendentes)
    expect(await verificar()).toMatchObject({ integra: true, verificados: 4, naoSelados: 0 })
  })

  it("trilha nova: cada registro é selado pelo servidor que o gravou, e a verificação passa sem nenhuma ação", async () => {
    add(3)
    for (const id of [1, 2, 3]) await sealOwnId(id)
    expect(await verificar()).toMatchObject({ integra: true, verificados: 3 })
  })
})
