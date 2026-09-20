// CNPJ: só dígitos, validação dos dois dígitos verificadores e formatação. Puro (usado no servidor e na tela).

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "")
}

function checkDigit(base: string): number {
  // pesos 2..9 da direita para a esquerda, repetindo
  let sum = 0
  let weight = 2
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

// 14 dígitos, não todos iguais, e os dois dígitos verificadores corretos.
export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value)
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false
  const d1 = checkDigit(digits.slice(0, 12))
  const d2 = checkDigit(digits.slice(0, 12) + d1)
  return digits.endsWith(`${d1}${d2}`)
}

// 12345678000195 -> 12.345.678/0001-95 (devolve o texto como veio se não tiver 14 dígitos)
export function formatCnpj(value: string): string {
  const d = onlyDigits(value)
  if (d.length !== 14) return value
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
