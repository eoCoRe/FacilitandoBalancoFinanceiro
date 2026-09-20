import { beforeEach, describe, expect, it } from "vitest"
import { clearFailures, isRateLimited, recordFailure, releaseAttempt, reserveAttempt, resetRateLimits } from "@/lib/server/auth/rate-limit"

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
