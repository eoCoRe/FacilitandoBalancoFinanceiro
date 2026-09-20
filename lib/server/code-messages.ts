import type { CodeCheck } from "./verification"

// Texto para o usuário de cada resultado da conferência de um código de 6 dígitos. O contexto muda
// só o que fazer quando as tentativas acabam: no login, refazer a senha; na ativação do 2FA, pedir
// outro código.
export function codeCheckMessage(result: Exclude<CodeCheck, "ok">, context: "login" | "ativacao"): string {
  switch (result) {
    case "expirado":
      return "O código expirou. Peça um novo."
    case "bloqueado":
      return context === "login"
        ? "Muitas tentativas incorretas. Entre novamente com a sua senha."
        : "Muitas tentativas incorretas. Peça um novo código."
    default:
      return "Código incorreto."
  }
}
