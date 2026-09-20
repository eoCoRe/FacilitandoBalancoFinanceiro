import { beforeEach, describe, expect, it } from "vitest"
import { bucketCount, clearFailures, isRateLimited, MAX_BUCKETS, recordFailure, releaseAttempt, reserveAttempt, resetRateLimits } from "@/lib/server/auth/rate-limit"

beforeEach(() => resetRateLimits())

describe("rate-limit", () => {
  it("bloqueia depois do máximo de falhas na janela", () => {
    for (let i = 0; i < 4; i++) recordFailure("k", 1000, 0)
    expect(isRateLimited("k", 5, 1000, 0)).toBe(false)
    recordFailure("k", 1000, 0)
    expect(isRateLimited("k", 5, 1000, 0)).toBe(true)
  })

  it("libera quando a janela passa", () => {
    for (let i = 0; i < 5; i++) recordFailure("k", 1000, 0)
    expect(isRateLimited("k", 5, 1000, 999)).toBe(true)
    expect(isRateLimited("k", 5, 1000, 1000)).toBe(false)
  })

  it("chaves diferentes não se misturam, e limpar zera só a chave pedida", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("a", 1000, 0)
      recordFailure("b", 1000, 0)
    }
    clearFailures("a")
    expect(isRateLimited("a", 5, 1000, 0)).toBe(false)
    expect(isRateLimited("b", 5, 1000, 0)).toBe(true)
  })
})

describe("reserva de tentativas (contra rajadas paralelas)", () => {
  it("deixa passar no máximo `max` tentativas: a (max+1)ª é recusada mesmo sem nenhuma falha 'confirmada'", () => {
    const resultados = Array.from({ length: 8 }, () => reserveAttempt("k", 5, 1000, 0))
    expect(resultados).toEqual([true, true, true, true, true, false, false, false])
  })

  it("a reserva já conta como falha (fica valendo até ser limpa)", () => {
    reserveAttempt("k", 2, 1000, 0)
    reserveAttempt("k", 2, 1000, 0)
    expect(isRateLimited("k", 2, 1000, 0)).toBe(true)
  })

  it("acertar: clearFailures zera tudo; releaseAttempt devolve só UMA reserva (contador compartilhado, como o do IP)", () => {
    for (let i = 0; i < 3; i++) reserveAttempt("ip", 5, 1000, 0)
    releaseAttempt("ip", 1000, 0)
    expect(reserveAttempt("ip", 3, 1000, 0)).toBe(true) // sobraram 2 reservas: cabe mais uma
    expect(reserveAttempt("ip", 3, 1000, 0)).toBe(false)
    clearFailures("ip")
    expect(reserveAttempt("ip", 3, 1000, 0)).toBe(true)
  })

  it("devolver sem reserva nenhuma não quebra nem deixa o contador negativo", () => {
    releaseAttempt("nada", 1000, 0)
    reserveAttempt("nada", 1, 1000, 0)
    releaseAttempt("nada", 1000, 0)
    releaseAttempt("nada", 1000, 0)
    expect(reserveAttempt("nada", 1, 1000, 0)).toBe(true)
    expect(reserveAttempt("nada", 1, 1000, 0)).toBe(false)
  })

  it("a janela vence e as reservas somem", () => {
    for (let i = 0; i < 5; i++) reserveAttempt("k", 5, 1000, 0)
    expect(reserveAttempt("k", 5, 1000, 999)).toBe(false)
    expect(reserveAttempt("k", 5, 1000, 1000)).toBe(true)
  })
})

describe("teto de memória (chaves inventadas não enchem o processo)", () => {
  it("nunca passa do máximo de chaves, por mais chaves diferentes que cheguem", () => {
    for (let i = 0; i < MAX_BUCKETS * 2; i++) recordFailure(`login:email:lixo-${i}@x.com`, 15 * 60 * 1000, 1000)
    expect(bucketCount()).toBeLessThanOrEqual(MAX_BUCKETS)
  })

  it("ao encher, descarta primeiro os VENCIDOS (a chave recente e a que está sendo atacada continuam contadas)", () => {
    for (let i = 0; i < MAX_BUCKETS; i++) recordFailure(`velha-${i}`, 15 * 60 * 1000, 0)
    const depois = 16 * 60 * 1000 // todas as velhas venceram
    for (let i = 0; i < 5; i++) recordFailure("alvo", 15 * 60 * 1000, depois)
    expect(isRateLimited("alvo", 5, 15 * 60 * 1000, depois)).toBe(true)
    expect(bucketCount()).toBeLessThan(MAX_BUCKETS / 2)
  })

  it("cheio só de chaves recentes: descarta as mais ANTIGAS que não estão bloqueadas, e uma falha nova ainda entra", () => {
    for (let i = 0; i < MAX_BUCKETS; i++) recordFailure(`k-${i}`, 15 * 60 * 1000, 1000)
    recordFailure("nova", 15 * 60 * 1000, 1001)
    expect(bucketCount()).toBeLessThanOrEqual(MAX_BUCKETS)
    expect(isRateLimited("nova", 1, 15 * 60 * 1000, 1001)).toBe(true) // entrou
    expect(isRateLimited("k-0", 1, 15 * 60 * 1000, 1001)).toBe(false) // a mais antiga saiu
    expect(isRateLimited(`k-${MAX_BUCKETS - 1}`, 1, 15 * 60 * 1000, 1001)).toBe(true) // a mais nova ficou
  })

  it("INUNDAÇÃO de chaves falsas NÃO apaga um bloqueio ativo (o limite de quem está sendo atacado não é zerado)", () => {
    for (let i = 0; i < 5; i++) recordFailure("login:email:vitima@x.com", 15 * 60 * 1000, 500) // bloqueada, e é a MAIS ANTIGA
    expect(isRateLimited("login:email:vitima@x.com", 5, 15 * 60 * 1000, 600)).toBe(true)
    for (let i = 0; i < MAX_BUCKETS * 2; i++) recordFailure(`login:email:lixo-${i}@x.com`, 15 * 60 * 1000, 600)
    expect(bucketCount()).toBeLessThanOrEqual(MAX_BUCKETS)
    expect(isRateLimited("login:email:vitima@x.com", 5, 15 * 60 * 1000, 700)).toBe(true) // continua bloqueada
  })

  it("se TUDO estiver bloqueado e não houver o que descartar, a chave nova simplesmente não é rastreada (nada existente se perde)", () => {
    for (let i = 0; i < MAX_BUCKETS; i++) for (let f = 0; f < 5; f++) recordFailure(`b-${i}`, 15 * 60 * 1000, 1000)
    recordFailure("recem-chegada", 15 * 60 * 1000, 1001)
    expect(bucketCount()).toBe(MAX_BUCKETS)
    expect(isRateLimited("recem-chegada", 1, 15 * 60 * 1000, 1001)).toBe(false)
    expect(isRateLimited("b-0", 5, 15 * 60 * 1000, 1001)).toBe(true)
  })
})

describe("teto de memória: limites de 3 falhas e falha fechada", () => {
  it("um bloqueio de 3 falhas (recuperar-senha, ativar 2FA) também é protegido da inundação", () => {
    for (let i = 0; i < 3; i++) recordFailure("reset:email:vitima@x.com", 15 * 60 * 1000, 500)
    expect(isRateLimited("reset:email:vitima@x.com", 3, 15 * 60 * 1000, 600)).toBe(true)
    for (let i = 0; i < MAX_BUCKETS * 2; i++) recordFailure(`lixo-${i}`, 15 * 60 * 1000, 600)
    expect(isRateLimited("reset:email:vitima@x.com", 3, 15 * 60 * 1000, 700)).toBe(true)
  })

  it("tabela cheia de baldes protegidos: quem tenta reservar uma chave NOVA é RECUSADO (falha fechada), não deixado passar sem limite", () => {
    for (let i = 0; i < MAX_BUCKETS; i++) for (let f = 0; f < 5; f++) recordFailure(`b-${i}`, 15 * 60 * 1000, 1000)
    expect(reserveAttempt("alvo-novo", 5, 15 * 60 * 1000, 1001)).toBe(false)
    expect(recordFailure("alvo-novo", 15 * 60 * 1000, 1001)).toBe(false)
    expect(bucketCount()).toBe(MAX_BUCKETS)
  })
})
