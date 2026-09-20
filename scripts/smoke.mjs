#!/usr/bin/env node
// Teste de fumaça: exercita o app RODANDO (next start) com um Postgres de verdade, sem mocks.
// Os testes do Vitest simulam o Prisma; este confere que as peças funcionam juntas de fato
// (migrações, seed, sessão por cookie, permissões, cabeçalhos). Roda no CI (job "integration")
// e localmente:  pnpm build && pnpm start  (em outro terminal)  →  pnpm smoke
//
// Variáveis: SMOKE_BASE_URL (padrão http://localhost:3000), SMOKE_ADMIN_EMAIL e
// SMOKE_ADMIN_PASSWORD (padrão: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD do ambiente).
import assert from "node:assert/strict"

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
