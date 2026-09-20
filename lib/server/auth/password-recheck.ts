import { PASSWORD_MAX_LENGTH, verifyPassword } from "@/lib/server/auth/password"
import { clearFailures, isRateLimited, PASSWORD_CHECK_KEY, recordFailure } from "@/lib/server/auth/rate-limit"
import { TooManyRequestsError, ValidationError } from "@/lib/server/validation"

// Confere a SENHA ATUAL de quem já está logado antes de uma ação que enfraquece ou troca um fator de
// segurança (desligar o 2FA, cadastrar o app autenticador, gerar novos códigos de recuperação): uma
// sessão emprestada não basta. Erros contam no mesmo limite (5 a cada 15 min) das outras conferências.
export async function requireCurrentPassword(usuario: { id: number; senhaHash: string | null }, senha: unknown): Promise<void> {
  if (typeof senha !== "string" || !senha || senha.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError("Informe a sua senha para confirmar.")
  }
  const key = PASSWORD_CHECK_KEY(usuario.id)
  if (isRateLimited(key)) {
    throw new TooManyRequestsError("Muitas tentativas com a senha. Aguarde 15 minutos e tente novamente.")
  }
  if (!usuario.senhaHash || !(await verifyPassword(senha, usuario.senhaHash))) {
    recordFailure(key)
    throw new ValidationError("Senha incorreta.")
  }
  clearFailures(key)
}
