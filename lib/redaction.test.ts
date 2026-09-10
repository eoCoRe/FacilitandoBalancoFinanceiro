import { describe, expect, it } from "vitest"
import { redactCnpjCpf, redactRazaoSocial, redactSensitiveText } from "./redaction"

describe("redactCnpjCpf", () => {
  it("redige CNPJ formatado", () => {
    expect(redactCnpjCpf("Empresa CNPJ 12.345.678/0001-90 pagou em dia.")).toBe(
      "Empresa CNPJ [CNPJ REDIGIDO] pagou em dia.",
    )
  })

  it("redige CNPJ só com números (14 dígitos)", () => {
    expect(redactCnpjCpf("CNPJ: 12345678000190.")).toBe("CNPJ: [CNPJ REDIGIDO].")
  })

  it("redige CPF formatado", () => {
    expect(redactCnpjCpf("Sócio CPF 123.456.789-00 avalista.")).toBe("Sócio CPF [CPF REDIGIDO] avalista.")
  })

  it("redige CPF só com números (11 dígitos)", () => {
    expect(redactCnpjCpf("CPF 12345678900 do avalista.")).toBe("CPF [CPF REDIGIDO] do avalista.")
  })

  it("não altera texto sem identificadores", () => {
    expect(redactCnpjCpf("Balanço patrimonial do exercício 2025.")).toBe("Balanço patrimonial do exercício 2025.")
  })

  it("não confunde um número de 14 dígitos com um CPF de 11 (borda de palavra)", () => {
    expect(redactCnpjCpf("Código 12345678901234 de controle.")).toBe("Código [CNPJ REDIGIDO] de controle.")
  })

  it("redige múltiplas ocorrências no mesmo texto", () => {
    const texto = "CNPJ 12.345.678/0001-90 e CNPJ 98.765.432/0001-10."
    expect(redactCnpjCpf(texto)).toBe("CNPJ [CNPJ REDIGIDO] e CNPJ [CNPJ REDIGIDO].")
  })
})

describe("redactRazaoSocial", () => {
  it("substitui toda ocorrência exata da razão social, ignorando maiúsculas/minúsculas", () => {
    const texto = "A empresa Farmácia Bem-Estar Ltda declarou lucro. farmácia bem-estar ltda auditada."
    const resultado = redactRazaoSocial(texto, "Farmácia Bem-Estar Ltda")
    expect(resultado).toBe("A empresa [RAZÃO SOCIAL REDIGIDA] declarou lucro. [RAZÃO SOCIAL REDIGIDA] auditada.")
  })

  it("escapa caracteres especiais de regex no nome da empresa", () => {
    const texto = "Empresa J. Silva & Cia. (ME) reportou."
    const resultado = redactRazaoSocial(texto, "J. Silva & Cia. (ME)")
    expect(resultado).toBe("Empresa [RAZÃO SOCIAL REDIGIDA] reportou.")
  })

  it("devolve o texto original quando a razão social é vazia", () => {
    expect(redactRazaoSocial("texto qualquer", "  ")).toBe("texto qualquer")
  })
})

describe("redactSensitiveText", () => {
  it("combina CNPJ/CPF e razão social num único passo", () => {
    const texto = "Farmácia Bem-Estar Ltda, CNPJ 12.345.678/0001-90, solicita análise."
    const resultado = redactSensitiveText(texto, "Farmácia Bem-Estar Ltda")
    expect(resultado).toBe("[RAZÃO SOCIAL REDIGIDA], CNPJ [CNPJ REDIGIDO], solicita análise.")
  })

  it("funciona sem razaoSocial informada (só CNPJ/CPF)", () => {
    expect(redactSensitiveText("CNPJ 12.345.678/0001-90")).toBe("CNPJ [CNPJ REDIGIDO]")
  })
})
