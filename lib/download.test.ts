import { describe, expect, it } from "vitest"
import { filenameFromContentDisposition } from "./download"

describe("filenameFromContentDisposition", () => {
  it("lê o nome entre aspas ou sem aspas", () => {
    expect(filenameFromContentDisposition('attachment; filename="auditoria-2026-09-20.csv"', "x.csv")).toBe("auditoria-2026-09-20.csv")
    expect(filenameFromContentDisposition("attachment; filename=meus-dados.json", "x.json")).toBe("meus-dados.json")
  })

  it("prefere o filename* (UTF-8) quando existe", () => {
    expect(filenameFromContentDisposition("attachment; filename=\"a.csv\"; filename*=UTF-8''balan%C3%A7o.csv", "x.csv")).toBe("balanço.csv")
  })

  it("sem cabeçalho ou sem nome: usa o nome padrão", () => {
    expect(filenameFromContentDisposition(null, "padrao.csv")).toBe("padrao.csv")
    expect(filenameFromContentDisposition("attachment", "padrao.csv")).toBe("padrao.csv")
  })

  it("filename* malformado cai para o nome simples", () => {
    expect(filenameFromContentDisposition("attachment; filename=\"ok.csv\"; filename*=UTF-8''%E0%A4%A", "x.csv")).toBe("ok.csv")
  })
})
