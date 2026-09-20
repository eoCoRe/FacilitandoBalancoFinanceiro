import { describe, expect, it } from "vitest"
import { EXTRACAO_ITENS_MAX, selectEntriesToSend } from "./limits"

const linhas = (prefixo: string, n: number) => Array.from({ length: n }, (_, i) => `${prefixo}${i}`)

describe("selectEntriesToSend", () => {
  it("cabendo tudo: vai tudo, na ordem (as com conta primeiro), sem omitidas", () => {
    const r = selectEntriesToSend(["a", "b"], ["x", "y"])
    expect(r).toEqual({ enviar: ["a", "b", "x", "y"], omitidas: 0 })
  })

  it("passando do limite: as COM conta vão todas e só as SEM conta são cortadas — e a quantidade cortada é informada", () => {
    const r = selectEntriesToSend(linhas("c", 300), linhas("s", 300)) // 600 no total; limite 500
    expect(r.enviar).toHaveLength(EXTRACAO_ITENS_MAX)
    expect(r.enviar.slice(0, 300)).toEqual(linhas("c", 300)) // nenhum valor a lançar ficou de fora
    expect(r.omitidas).toBe(100)
  })

  it("só as COM conta já passam do limite: vão todas (o servidor recusa com aviso — nada é cortado em silêncio) e nenhuma sem conta", () => {
    const r = selectEntriesToSend(linhas("c", 520), linhas("s", 10))
    expect(r.enviar).toHaveLength(520)
    expect(r.omitidas).toBe(10)
  })

  it("respeita um limite informado", () => {
    expect(selectEntriesToSend(["a"], ["x", "y", "z"], 3)).toEqual({ enviar: ["a", "x", "y"], omitidas: 1 })
  })

  it("listas vazias", () => {
    expect(selectEntriesToSend([], [])).toEqual({ enviar: [], omitidas: 0 })
  })
})
