import { can, type Permission } from "@/lib/permissions"
import { getCurrentUser, type SessionUser } from "./current-user"
import { ForbiddenError, UnauthorizedError } from "./validation"

export type { SessionUser }

// Primeira linha de toda rota de API que não é pública. Lança 401 (sem login) ou 403 (login
// válido, mas o perfil não pode fazer isso); handleRouteError converte no status certo.
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError("Faça login para continuar.")
  return user
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.papel, permission)) {
    throw new ForbiddenError("Seu perfil não tem permissão para esta ação.")
  }
  return user
}
