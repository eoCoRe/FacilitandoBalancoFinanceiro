// CSV para abrir no Excel/Sheets (RFC 4180: campos entre aspas, aspas duplicadas, linhas com CRLF).

// Injeção de fórmula: uma célula que COMEÇA com = + - @ (ou tab/CR) é executada como fórmula pelas
// planilhas. Os textos da auditoria vêm de dados digitados por usuários (nomes de contas, e-mails),
// então qualquer um poderia plantar `=HYPERLINK(...)` e atacar quem abrir o arquivo. Prefixar com
// apóstrofo faz a planilha tratar como texto. (OWASP: CSV Injection.)
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

// BOM UTF-8 no início: sem ele o Excel abre acentos como lixo.
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
