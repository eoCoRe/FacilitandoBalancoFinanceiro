import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PAPEIS, type Papel } from "@/lib/permissions"
import { getCurrentUser } from "@/lib/server/auth/current-user"

// As rotas rejeitam ANTES de tocar no banco; se alguma tocasse, este objeto vazio faria o
// teste falhar em vez de passar por acaso.
vi.mock("@/lib/db", () => ({ prisma: {} }))

import * as empresa from "./empresa/route"
import * as exercicios from "./exercicios/route"
import * as exerciciosId from "./exercicios/[id]/route"
import * as planoDeContas from "./plano-de-contas/route"
import * as planoDeContasId from "./plano-de-contas/[id]/route"
import * as valores from "./valores/route"
import * as dre from "./dre/route"
import * as dfc from "./dfc/route"
import * as indices from "./indices/route"
import * as auditoria from "./auditoria/route"
import * as auditoriaExportar from "./auditoria/exportar/route"
import * as auditoriaIntegridade from "./auditoria/integridade/route"
import * as extracoes from "./extracoes/route"
import * as extracoesId from "./extracoes/[id]/route"
import * as usuarios from "./usuarios/route"
import * as usuariosId from "./usuarios/[id]/route"
import * as lgpdExportacao from "./lgpd/exportacao/route"
import * as lgpdEliminacao from "./lgpd/eliminacao/route"
import * as me from "./auth/me/route"
import * as senha from "./auth/senha/route"
import * as meusDados from "./auth/meus-dados/route"
import * as sessoesEncerrar from "./auth/sessoes/encerrar-outras/route"
import * as tfaAtivar from "./auth/2fa/ativar/route"
import * as tfaConfirmar from "./auth/2fa/confirmar/route"
import * as tfaDesativar from "./auth/2fa/desativar/route"
import * as totpCodigos from "./auth/2fa/totp/codigos/route"
import * as totpConfirmar from "./auth/2fa/totp/confirmar/route"
import * as totpDesativar from "./auth/2fa/totp/desativar/route"
import * as totpIniciar from "./auth/2fa/totp/iniciar/route"
import * as seguranca from "./seguranca/route"

const json = (method: string, body: unknown = {}) =>
  new Request("http://localhost/api/x", { method, body: JSON.stringify(body) })
const params = { params: Promise.resolve({ id: "1" }) }

// Cada linha: a rota e o perfil MÍNIMO que pode usá-la. Esta tabela é a especificação de
// RNF02; se alguém afrouxar uma permissão por engano, um caso daqui quebra.
const ROTAS: { nome: string; min: Papel; chamar: () => Promise<Response> }[] = [
  { nome: "GET /api/empresa", min: "ANALISTA", chamar: () => empresa.GET() },
  { nome: "PATCH /api/empresa", min: "COORDENADOR", chamar: () => empresa.PATCH(json("PATCH", { setor: "X" })) },
  { nome: "POST /api/exercicios", min: "ANALISTA", chamar: () => exercicios.POST(json("POST", { periodo: "1T2030" })) },
  { nome: "PATCH /api/exercicios/:id", min: "COORDENADOR", chamar: () => exerciciosId.PATCH(json("PATCH", { auditado: true }), params) },
  { nome: "GET /api/plano-de-contas", min: "ANALISTA", chamar: () => planoDeContas.GET() },
  { nome: "POST /api/plano-de-contas", min: "COORDENADOR", chamar: () => planoDeContas.POST(json("POST", { parentId: null, nome: "X" })) },
  { nome: "PATCH /api/plano-de-contas/:id", min: "COORDENADOR", chamar: () => planoDeContasId.PATCH(json("PATCH", { nome: "X" }), params) },
  { nome: "DELETE /api/plano-de-contas/:id", min: "COORDENADOR", chamar: () => planoDeContasId.DELETE(json("DELETE"), params) },
  { nome: "PUT /api/valores", min: "ANALISTA", chamar: () => valores.PUT(json("PUT", { contaId: 1, exercicioId: 1, valor: 1 })) },
  { nome: "GET /api/dre", min: "ANALISTA", chamar: () => dre.GET() },
  { nome: "GET /api/dfc", min: "ANALISTA", chamar: () => dfc.GET() },
  { nome: "GET /api/indices", min: "ANALISTA", chamar: () => indices.GET(new Request("http://localhost/api/indices")) },
  { nome: "GET /api/auditoria", min: "ANALISTA", chamar: () => auditoria.GET(new Request("http://localhost/api/auditoria")) },
  { nome: "GET /api/auditoria/exportar", min: "COORDENADOR", chamar: () => auditoriaExportar.GET(new Request("http://localhost/api/auditoria/exportar")) },
  { nome: "POST /api/auditoria/integridade", min: "COORDENADOR", chamar: () => auditoriaIntegridade.POST() },
  { nome: "GET /api/extracoes", min: "ANALISTA", chamar: () => extracoes.GET() },
  { nome: "GET /api/extracoes/:id", min: "ANALISTA", chamar: () => extracoesId.GET(new Request("http://localhost/api/extracoes/1"), params) },
  { nome: "POST /api/extracoes", min: "ANALISTA", chamar: () => extracoes.POST(json("POST", {})) },
  { nome: "GET /api/usuarios", min: "ADMINISTRADOR", chamar: () => usuarios.GET() },
  { nome: "POST /api/usuarios", min: "ADMINISTRADOR", chamar: () => usuarios.POST(json("POST", {})) },
  { nome: "PATCH /api/usuarios/:id", min: "ADMINISTRADOR", chamar: () => usuariosId.PATCH(json("PATCH", { ativo: false }), params) },
  { nome: "GET /api/lgpd/exportacao", min: "ADMINISTRADOR", chamar: () => lgpdExportacao.GET() },
  { nome: "DELETE /api/lgpd/eliminacao", min: "ADMINISTRADOR", chamar: () => lgpdEliminacao.DELETE(json("DELETE")) },
  { nome: "GET /api/auth/me", min: "ANALISTA", chamar: () => me.GET() },
  { nome: "GET /api/auth/meus-dados", min: "ANALISTA", chamar: () => meusDados.GET() },
  { nome: "POST /api/auth/senha", min: "ANALISTA", chamar: () => senha.POST(json("POST", {})) },
  { nome: "POST /api/auth/sessoes/encerrar-outras", min: "ANALISTA", chamar: () => sessoesEncerrar.POST() },
  { nome: "POST /api/auth/2fa/ativar", min: "ANALISTA", chamar: () => tfaAtivar.POST() },
  { nome: "POST /api/auth/2fa/confirmar", min: "ANALISTA", chamar: () => tfaConfirmar.POST(json("POST", {})) },
  { nome: "POST /api/auth/2fa/desativar", min: "ANALISTA", chamar: () => tfaDesativar.POST(json("POST", {})) },
  { nome: "POST /api/auth/2fa/totp/iniciar", min: "ANALISTA", chamar: () => totpIniciar.POST(json("POST", {})) },
  { nome: "POST /api/auth/2fa/totp/confirmar", min: "ANALISTA", chamar: () => totpConfirmar.POST(json("POST", {})) },
  { nome: "POST /api/auth/2fa/totp/desativar", min: "ANALISTA", chamar: () => totpDesativar.POST(json("POST", {})) },
  { nome: "POST /api/auth/2fa/totp/codigos", min: "ANALISTA", chamar: () => totpCodigos.POST(json("POST", {})) },
  { nome: "GET /api/seguranca", min: "ADMINISTRADOR", chamar: () => seguranca.GET() },
  { nome: "PUT /api/seguranca", min: "ADMINISTRADOR", chamar: () => seguranca.PUT(json("PUT", { papel: "ANALISTA", doisFatoresObrigatorio: true })) },
]

const usuarioComPapel = (papel: Papel) => ({ id: 9, email: `${papel.toLowerCase()}@teste.com`, nome: papel, papel })

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(ROTAS)("$nome", ({ min, chamar }) => {
  it("sem login responde 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await chamar()
    expect(response.status).toBe(401)
  })

  // O outro lado da moeda: quem TEM o perfil mínimo (ou acima) não pode ser barrado por engano. O
  // prisma é um objeto vazio, então depois de passar pela checagem a rota pode devolver 400 ou lançar
  // um erro de banco — o que não pode é ser 401/403.
  it(`perfil ${min} e acima passam pela checagem de acesso`, async () => {
    for (const papel of PAPEIS.slice(PAPEIS.indexOf(min))) {
      vi.mocked(getCurrentUser).mockResolvedValue(usuarioComPapel(papel))
      let status: number | null = null
      try {
        status = (await chamar()).status
      } catch {
        // erro do "banco" simulado: a checagem de acesso já tinha passado.
      }
      expect([401, 403], `${papel} foi barrado indevidamente`).not.toContain(status)
    }
  })

  const abaixo = PAPEIS.slice(0, PAPEIS.indexOf(min))
  it.skipIf(abaixo.length === 0)(`perfil abaixo de ${min} responde 403`, async () => {
    for (const papel of abaixo) {
      vi.mocked(getCurrentUser).mockResolvedValue(usuarioComPapel(papel))
      const response = await chamar()
      expect(response.status, `${papel} deveria ser barrado`).toBe(403)
    }
  })
})

// Rede de segurança para o futuro: uma rota nova esquecida sem proteção quebra AQUI, antes de
// chegar em produção. Só as rotas abaixo podem ser abertas, e por motivo explícito.
describe("toda rota de API exige login ou está na lista de rotas públicas", () => {
  const PUBLICAS: Record<string, string> = {
    "health/route.ts": "verificação de saúde para monitoramento (não expõe dados de negócio)",
    "auth/login/route.ts": "é onde o login acontece",
    "auth/logout/route.ts": "sair já estando fora não é erro",
    "auth/google/route.ts": "início do login com Google",
    "auth/google/callback/route.ts": "retorno do login com Google (valida state/PKCE e cadastro)",
    "auth/recuperar-senha/route.ts": "quem esqueceu a senha não tem sessão; resposta idêntica exista a conta ou não, com limite de pedidos",
    "auth/redefinir-senha/route.ts": "quem tem o link de uso único recebido por e-mail; sem ele nada acontece",
    "auth/2fa/verificar/route.ts": "2º passo do login: exige o cookie assinado do passo 1 e o código do e-mail",
    "auth/2fa/reenviar/route.ts": "reenvio do código: exige o cookie assinado do passo 1",
  }

  function listarRotas(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return listarRotas(full)
      return entry.name === "route.ts" ? [full] : []
    })
  }

  const raiz = join(__dirname)
  const rotas = listarRotas(raiz).map((f) => ({ arquivo: f, rel: relative(raiz, f).replaceAll("\\", "/") }))

  it("encontra as rotas (sanidade do próprio teste)", () => {
    expect(rotas.length).toBeGreaterThan(10)
  })

  it.each(rotas)("$rel", ({ arquivo, rel }) => {
    if (rel in PUBLICAS) return
    const codigo = readFileSync(arquivo, "utf-8")
    expect(codigo, `${rel} não chama requirePermission()/requireUser()`).toMatch(/require(Permission|User)\(/)
  })
})
