import type { Usuario } from "@prisma/client"

// O que a tela de administração pode ver de um usuário — nunca o hash da senha nem o id
// interno do Google.
export function toUsuarioDto(usuario: Usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    ativo: usuario.ativo,
    temSenha: usuario.senhaHash !== null,
    temGoogle: usuario.googleSub !== null,
    doisFatoresAtivo: usuario.doisFatoresAtivo,
    ultimoLoginEm: usuario.ultimoLoginEm,
    criadoEm: usuario.criadoEm,
  }
}
