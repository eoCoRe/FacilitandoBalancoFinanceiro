// Redação de identificadores/dados pessoais antes do envio a uma API de LLM externa —
// pré-requisito de segurança do RFC (§5.4/§5.5) para quando a extração real (RF02)
// existir. Hoje a extração é mock (lib/mock-extraction.ts) e não chama LLM nenhum, então
// nada usa esta função ainda; o motor puro fica pronto para o dia em que passar a chamar,
// chamado uma única vez sobre o texto extraído do PDF antes de montar o prompt.

const CNPJ_FORMATADO = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
const CNPJ_NUMERICO = /\b\d{14}\b/g
const CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g
const CPF_NUMERICO = /\b\d{11}\b/g

// CNPJ é dado da empresa-cliente (pessoa jurídica); CPF cobre o dado pessoal que pode
// aparecer no mesmo documento (sócios, avalistas, MEI — ver SECURITY.md).
export function redactCnpjCpf(text: string): string {
  return text
    .replace(CNPJ_FORMATADO, "[CNPJ REDIGIDO]")
    .replace(CNPJ_NUMERICO, "[CNPJ REDIGIDO]")
    .replace(CPF_FORMATADO, "[CPF REDIGIDO]")
    .replace(CPF_NUMERICO, "[CPF REDIGIDO]")
}

// Substitui toda ocorrência exata da razão social (case-insensitive) pelo placeholder —
// busca literal, não fuzzy, para não mascarar texto que só parece com o nome da empresa.
export function redactRazaoSocial(text: string, razaoSocial: string): string {
  const nome = razaoSocial.trim()
  if (!nome) return text
  const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(escaped, "gi"), "[RAZÃO SOCIAL REDIGIDA]")
}

// Ponto único de chamada antes de montar o prompt para o LLM externo (RF02) — cobre
// identificadores (CNPJ/CPF) e o nome da empresa-cliente.
export function redactSensitiveText(text: string, razaoSocial?: string): string {
  const semIdentificadores = redactCnpjCpf(text)
  return razaoSocial ? redactRazaoSocial(semIdentificadores, razaoSocial) : semIdentificadores
}
