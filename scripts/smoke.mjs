#!/usr/bin/env node
// Teste de fumaça: exercita o app RODANDO (next start) com um Postgres de verdade, sem mocks.
// Os testes do Vitest simulam o Prisma; este confere que as peças funcionam juntas de fato
// (migrações, seed, sessão por cookie, permissões, cabeçalhos). Roda no CI (job "integration")
// e localmente:  pnpm build && pnpm start  (em outro terminal)  →  pnpm smoke
//
// Variáveis: SMOKE_BASE_URL (padrão http://localhost:3000), SMOKE_ADMIN_EMAIL e
// SMOKE_ADMIN_PASSWORD (padrão: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD do ambiente).
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD (ou SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD).")
  process.exit(2)
}

// Um "navegador" mínimo: guarda os cookies entre as chamadas.
function client() {
  const jar = new Map()
  const cookieHeader = () => [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ")
  return {
    async call(method, path, body) {
      const headers = {}
      if (body !== undefined) headers["Content-Type"] = "application/json"
      if (jar.size) headers.cookie = cookieHeader()
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      })
      for (const setCookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = setCookie.split(";")
        const i = pair.indexOf("=")
        jar.set(pair.slice(0, i), pair.slice(i + 1))
      }
      let json = null
      try {
        json = await res.clone().json()
      } catch {
        // resposta sem JSON (página, redirecionamento)
      }
      return { status: res.status, json, headers: res.headers }
    },
  }
}

// TOTP (RFC 6238) escrito de novo aqui, de propósito: não reaproveita o código do app, então um erro nele aparece.
function totp(base32, step) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...base32.replace(/\s/g, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("")
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0)
  counter.writeUInt32BE(step >>> 0, 4)
  const h = createHmac("sha1", key).update(counter).digest()
  const o = h[19] & 15
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0")
}

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`  FALHOU  ${name}\n          ${error.message.split("\n")[0]}`)
    process.exitCode = 1
    throw error // uma falha interrompe: os passos seguintes dependem dos anteriores
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`o servidor não respondeu em ${BASE}/api/health`)
}

console.log(`Teste de fumaça contra ${BASE}`)
try {
  await waitForServer()
  const anon = client()
  const admin = client()
  const analista = client()
  const sufixo = Date.now()
  const analistaCreds = { email: `smoke.${sufixo}@teste.local`, senha: "senha-do-smoke-12345" }

  await check("saúde: API e banco no ar", async () => {
    const r = await anon.call("GET", "/api/health")
    assert.equal(r.status, 200)
    assert.equal(r.json.database, "ok")
  })

  await check("sem login: API responde 401 e a página manda para /login", async () => {
    assert.equal((await anon.call("GET", "/api/empresa")).status, 401)
    assert.equal((await anon.call("GET", "/api/usuarios")).status, 401)
    const page = await anon.call("GET", "/")
    assert.equal(page.status, 307)
    assert.match(page.headers.get("location") ?? "", /\/login$/)
  })

  await check("cabeçalhos de segurança e API sem cache", async () => {
    const page = await anon.call("GET", "/login")
    assert.equal(page.status, 200)
    assert.equal(page.headers.get("x-frame-options"), "DENY")
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/)
    assert.equal(page.headers.get("x-content-type-options"), "nosniff")
    const api = await anon.call("GET", "/api/empresa")
    assert.match(api.headers.get("cache-control") ?? "", /no-store/)
  })

  await check("login do administrador (cookie httpOnly) e /api/auth/me", async () => {
    const bad = await client().call("POST", "/api/auth/login", { email: ADMIN_EMAIL, senha: "senha-errada-123" })
    assert.equal(bad.status, 401)
    const ok = await admin.call("POST", "/api/auth/login", { email: ADMIN_EMAIL, senha: ADMIN_PASSWORD })
    assert.equal(ok.status, 200, JSON.stringify(ok.json))
    assert.match(ok.headers.getSetCookie().join(";"), /HttpOnly/i)
    const me = await admin.call("GET", "/api/auth/me")
    assert.equal(me.json.user.papel, "ADMINISTRADOR")
  })

  let contaId
  let exercicioId
  await check("leitura: empresa, plano de contas, DRE e DFC vindos do banco (seed)", async () => {
    const empresa = await admin.call("GET", "/api/empresa")
    assert.equal(empresa.status, 200)
    assert.ok(empresa.json.exercicios.length >= 1, "seed deveria ter exercícios")
    exercicioId = empresa.json.exercicios.at(-1).id
    const plano = await admin.call("GET", "/api/plano-de-contas")
    assert.ok(plano.json.contas.length >= 1, "plano de contas vazio")
    // primeira conta analítica (folha) do primeiro grupo
    const folha = (function achar(nodes) {
      for (const n of nodes) {
        if (!n.ehGrupo) return n
        const f = achar(n.subcontas ?? [])
        if (f) return f
      }
      return null
    })(plano.json.contas)
    assert.ok(folha, "nenhuma conta analítica no plano")
    contaId = folha.id
    assert.equal((await admin.call("GET", "/api/dre")).status, 200)
    assert.equal((await admin.call("GET", "/api/dfc")).status, 200)
  })

  await check("escrita: lançar um valor e lê-lo de volta (e restaurar)", async () => {
    const antes = (await admin.call("GET", "/api/plano-de-contas")).json
    const achar = (nodes) => {
      for (const n of nodes) {
        if (n.id === contaId) return n
        const f = achar(n.subcontas ?? [])
        if (f) return f
      }
    }
    const periodo = (await admin.call("GET", "/api/empresa")).json.exercicios.at(-1).periodo
    const original = achar(antes.contas).valores[periodo]
    const put = await admin.call("PUT", "/api/valores", { contaId, exercicioId, valor: 4242 })
    assert.equal(put.status, 200, JSON.stringify(put.json))
    const depois = achar((await admin.call("GET", "/api/plano-de-contas")).json.contas).valores[periodo]
    assert.equal(depois, 4242)
    await admin.call("PUT", "/api/valores", { contaId, exercicioId, valor: original ?? null })
  })

  await check("administrador cria um analista; a auditoria registra o e-mail real", async () => {
    const criar = await admin.call("POST", "/api/usuarios", {
      nome: "Analista de fumaça",
      email: analistaCreds.email,
      papel: "ANALISTA",
      senha: analistaCreds.senha,
    })
    assert.equal(criar.status, 201, JSON.stringify(criar.json))
    assert.ok(!JSON.stringify(criar.json).includes("scrypt"), "o hash da senha não pode sair da API")
    const auditoria = (await admin.call("GET", "/api/auditoria")).json.logs
    assert.ok(auditoria.some((l) => l.acao === "Usuário criado" && l.usuario === ADMIN_EMAIL))
  })

  await check("permissões reais: o analista lança valores, mas não gerencia contas nem usuários", async () => {
    const login = await analista.call("POST", "/api/auth/login", { email: analistaCreds.email, senha: analistaCreds.senha })
    assert.equal(login.status, 200)
    assert.equal((await analista.call("PUT", "/api/valores", { contaId, exercicioId, valor: 1 })).status, 200)
    assert.equal((await analista.call("POST", "/api/plano-de-contas", { parentId: null, nome: "X" })).status, 403)
    assert.equal((await analista.call("GET", "/api/usuarios")).status, 403)
    assert.equal((await analista.call("GET", "/api/lgpd/exportacao")).status, 403)
  })

  await check("a trilha de auditoria está selada e íntegra (selagem e transação no Postgres de verdade)", async () => {
    const r = await admin.call("GET", "/api/auditoria/integridade")
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.integra, true, JSON.stringify(r.json))
    assert.ok(r.json.verificados > 0)
    assert.equal(r.json.naoSelados, 0)
    assert.equal((await analista.call("GET", "/api/auditoria/integridade")).status, 403)
  })

  await check("2FA por app autenticador: ligar, entrar com o código do app e com um código de recuperação", async () => {
    const senha = analistaCreds.senha
    const iniciar = await analista.call("POST", "/api/auth/2fa/totp/iniciar", { senha })
    assert.equal(iniciar.status, 200, JSON.stringify(iniciar.json))
    const chave = iniciar.json.segredo
    const passo = Math.floor(Date.now() / 30000)
    const confirmar = await analista.call("POST", "/api/auth/2fa/totp/confirmar", { codigo: totp(chave, passo) })
    assert.equal(confirmar.status, 200, JSON.stringify(confirmar.json))
    assert.equal(confirmar.json.codigosRecuperacao.length, 8)

    // um novo "navegador": senha certa NÃO basta, pede o segundo passo
    const outro = client()
    const passo1 = await outro.call("POST", "/api/auth/login", { email: analistaCreds.email, senha })
    assert.equal(passo1.json.segundoFator, true)
    assert.equal(passo1.json.metodo, "app")
    assert.equal((await outro.call("GET", "/api/empresa")).status, 401)
    // não há como trocar para o código por e-mail
    assert.equal((await outro.call("POST", "/api/auth/2fa/reenviar")).status, 400)
    // o código usado no cadastro não vale de novo (anti-replay); o do passo seguinte vale
    assert.equal((await outro.call("POST", "/api/auth/2fa/verificar", { codigo: totp(chave, passo) })).status, 401)
    const entrou = await outro.call("POST", "/api/auth/2fa/verificar", { codigo: totp(chave, passo + 1) })
    assert.equal(entrou.status, 200, JSON.stringify(entrou.json))
    assert.equal((await outro.call("GET", "/api/empresa")).status, 200)

    // código de recuperação: uma vez só
    const [recuperacao] = confirmar.json.codigosRecuperacao
    const terceiro = client()
    await terceiro.call("POST", "/api/auth/login", { email: analistaCreds.email, senha })
    assert.equal((await terceiro.call("POST", "/api/auth/2fa/verificar", { codigo: recuperacao })).status, 200)
    const quarto = client()
    await quarto.call("POST", "/api/auth/login", { email: analistaCreds.email, senha })
    assert.equal((await quarto.call("POST", "/api/auth/2fa/verificar", { codigo: recuperacao })).status, 401)
  })

  await check("desativar o analista derruba o acesso na hora", async () => {
    const lista = (await admin.call("GET", "/api/usuarios")).json.usuarios
    const alvo = lista.find((u) => u.email === analistaCreds.email)
    assert.equal((await admin.call("PATCH", `/api/usuarios/${alvo.id}`, { ativo: false })).status, 200)
    assert.equal((await analista.call("GET", "/api/empresa")).status, 401)
  })

  console.log(`\nTeste de fumaça: ${passed} verificações passaram.`)
} catch (error) {
  console.error(`\nTeste de fumaça FALHOU: ${error.message.split("\n")[0]}`)
  process.exit(1)
}
