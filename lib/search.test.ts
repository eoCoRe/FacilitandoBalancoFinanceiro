import { describe, expect, it } from "vitest"
import { createSeedAccounts, INDICATORS } from "./financial-data"
import { buildSearchEntries, normalize, searchEntries } from "./search"

const accounts = createSeedAccounts()
const todas = buildSearchEntries({ accounts, isAdmin: true })
const labels = (q: string, entries = todas) => searchEntries(entries, q).map((e) => e.label)

describe("normalize", () => {
  it("tira acento e maiúsculas", () => {
    expect(normalize("  Balanço · DRÉ ")).toBe("balanco · dre")
  })
})

describe("buildSearchEntries", () => {
  it("inclui todas as telas, todos os índices e as contas do plano", () => {
    const porTipo = (k: string) => todas.filter((e) => e.kind === k)
    expect(porTipo("Tela").map((e) => e.screen)).toEqual(
      expect.arrayContaining(["opiniao-de-venda", "dashboard", "indices", "plano-de-contas", "tabulacao", "demonstracoes", "extracao-ia", "auditoria", "usuarios"]),
    )
    expect(porTipo("Índice")).toHaveLength(INDICATORS.length)
    expect(porTipo("Conta").length).toBeGreaterThan(10)
  })

  it("a tela de Usuários só existe para o administrador (quem não pode gerir usuários nem a encontra)", () => {
    const semAdmin = buildSearchEntries({ accounts, isAdmin: false })
    expect(semAdmin.some((e) => e.screen === "usuarios")).toBe(false)
    expect(todas.some((e) => e.screen === "usuarios")).toBe(true)
  })

  it("cada destino aponta para a tela certa", () => {
    expect(todas.find((e) => e.kind === "Índice")!.screen).toBe("indices")
    expect(todas.find((e) => e.kind === "Conta")!.screen).toBe("plano-de-contas")
  })
})

describe("searchEntries", () => {
  it("sem busca: só as telas", () => {
    const r = searchEntries(todas, "  ")
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((e) => e.kind === "Tela")).toBe(true)
  })

  it("acha sem depender de acento nem de maiúsculas", () => {
    expect(labels("EXTRACAO")).toContain("Extração de PDF")
    expect(labels("balanco")).toContain("Balanço · DRE · DFC")
    expect(labels("liquidez corrente")).toContain("Liquidez Corrente")
  })

  it("acha por código de conta", () => {
    const disponibilidades = accounts
      .flatMap((a) => [a, ...(a.children ?? []).flatMap((c) => [c, ...(c.children ?? [])])])
      .find((a) => a.name === "Disponibilidades")!
    const r = searchEntries(todas, disponibilidades.code)
    expect(r.some((e) => e.kind === "Conta" && e.label === "Disponibilidades")).toBe(true)
  })

  it("todas as palavras precisam aparecer (em qualquer ordem)", () => {
    expect(labels("corrente liquidez")).toContain("Liquidez Corrente")
    expect(labels("liquidez zzzz")).toEqual([])
  })

  it("quem COMEÇA com a busca vem antes de quem só contém, e telas antes de índices antes de contas", () => {
    const r = searchEntries(todas, "aud")
    expect(r[0].label).toBe("Auditoria")
    const kinds = searchEntries(todas, "l").map((e) => e.kind)
    // dentro da mesma faixa de relevância a ordem é tela, índice, conta
    expect(kinds.indexOf("Tela")).toBeLessThan(kinds.lastIndexOf("Conta"))
  })

  it("limita o número de resultados", () => {
    expect(searchEntries(todas, "a").length).toBeLessThanOrEqual(30)
  })

  it("sem resultado devolve lista vazia", () => {
    expect(searchEntries(todas, "xyzabc")).toEqual([])
  })
})
