import { beforeEach, describe, expect, it } from "vitest"
import { clearFailures, isRateLimited, recordFailure, resetRateLimits } from "./rate-limit"

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
