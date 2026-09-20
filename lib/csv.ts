// CSV para abrir no Excel/Sheets (RFC 4180: campos entre aspas, aspas duplicadas, linhas com CRLF).
// Puro (sem servidor nem React): usado pela exportação da auditoria (servidor) e pelas exportações de
// demonstrações e índices (navegador).
//
// O separador é ponto e vírgula: o Excel em português usa `;` como separador de lista e, com vírgula, abre o
// arquivo inteiro numa única coluna. Google Sheets e LibreOffice detectam o separador sozinhos.
export const CSV_DELIMITER = ";"

// Injeção de fórmula: uma célula que COMEÇA com = + - @ (ou tab/CR) é executada como fórmula pelas
// planilhas. Os textos exportados vêm de dados digitados por usuários (nomes de contas, e-mails), então
// qualquer um poderia plantar `=HYPERLINK(...)` e atacar quem abrir o arquivo. Prefixar com apóstrofo faz a
// planilha tratar como texto. (OWASP: CSV Injection.)
const FORMULA_START = /^[=+\-@\t\r]/
// Exceção: um NÚMERO negativo ("-1050", "-1050,5") também começa com "-", mas não é fórmula — só dígitos e uma
// vírgula ou ponto decimal, nada executável. Sem esta exceção, prejuízos e outros valores negativos das
// demonstrações sairiam como texto ("'-1050,5") e não somariam na planilha.
const NEGATIVE_NUMBER = /^-\d+(?:[.,]\d+)?$/

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (FORMULA_START.test(text) && !NEGATIVE_NUMBER.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

// BOM UTF-8 no início (escape explícito, para não depender de um caractere invisível no código): sem ele o
// Excel abre os acentos como lixo.
const BOM = "﻿"

export function toCsv(header: string[], rows: unknown[][], delimiter: string = CSV_DELIMITER): string {
  return BOM + [header, ...rows].map((row) => row.map(csvCell).join(delimiter)).join("\r\n") + "\r\n"
}
