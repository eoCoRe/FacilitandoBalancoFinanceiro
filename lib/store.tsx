"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { api, ApiError, errorMessage } from "./api-client"
import {
  mapAuditoria,
  mapContas,
  mapDre,
  mapSnapshot,
  type AuditEntry,
  type AuditoriaPayload,
  type AuthUser,
  type ContaNodePayload,
  type DfcPayload,
  type DrePayload,
  type EmpresaPayload,
  type Exercicio,
  type FinancialSnapshot,
  type IdIndex,
} from "./api-mapping"
import type { Account } from "./financial-data"
import { dreLineIdFromCode } from "./extraction/pdf-extraction"
import { sectorLabel } from "./sector-benchmarks"
import type { Decisao, ParecerRegistrado } from "./parecer"

export type { AuditEntry, Exercicio }

// Os dados vêm do Postgres pelas rotas de /api. O store mantém uma cópia em memória no formato
// que as telas consomem: edições de valor são aplicadas na hora (a tela é controlada pelo
// estado) e gravadas em segundo plano; mudanças estruturais (plano de contas, exercícios,
// extração) esperam o servidor e recarregam o que mudou.

type Status = "loading" | "ready" | "error"

export interface NovoParecer {
  valorSolicitado: number
  decisao: Decisao
  limiteAprovado: number | null
  validadeAte: string | null
  justificativa: string
}

export interface ExtractionEntry {
  // null = o leitor viu a linha mas ela não foi ligada a nenhuma conta: só rastreabilidade, não lança valor.
  code: string | null
  value: number
  confidence: number
  page?: number
  // Texto exato lido no documento (guardado como origem do valor).
  label?: string
}

interface StoreApi extends FinancialSnapshot {
  status: Status
  loadError: string | null
  // Código que o servidor mandou junto do erro de carga (ex.: "SEM_EMPRESA": não há empresa cadastrada).
  loadErrorCode: string | null
  mutationError: string | null
  dismissMutationError: () => void
  reload: () => void
  setSector: (sectorId: string) => void
  // Devolve o id do exercício criado, ou null se o servidor recusou (ex.: período já existe).
  addExercicio: (label: string) => Promise<string | null>
  // Marca/desmarca o exercício como auditado (informativo; só coordenador ou acima).
  setExercicioAuditado: (exercicioId: string, auditado: boolean) => void
  updateAccountValue: (code: string, exercicioId: string, value: number | undefined) => void
  updateDreValue: (exercicioId: string, lineId: string, value: number | undefined) => void
  addAccountNode: (parentCode: string | null, name: string, isGroup: boolean) => Promise<boolean>
  renameAccountNode: (code: string, name: string) => Promise<boolean>
  deleteAccountNode: (code: string) => Promise<boolean>
  // `origem`: quem leu os valores — o leitor de PDF (padrão) ou o analista digitando olhando o documento.
  confirmExtraction: (exercicioId: string, entries: ExtractionEntry[], fileName: string, origem?: OrigemExtracao) => Promise<boolean>
  // Registra a decisão de crédito (coordenador ou acima). Devolve o parecer gravado, ou null se o servidor recusou.
  registrarParecer: (exercicioId: string, dados: NovoParecer) => Promise<ParecerRegistrado | null>
}

const EMPTY: FinancialSnapshot = {
  // Placeholder de menor privilégio: o app só renderiza depois da carga (StoreLoadGate).
  user: { id: 0, nome: "", email: "", papel: "ANALISTA", doisFatoresAtivo: false, totpAtivo: false, doisFatoresObrigatorio: false } satisfies AuthUser,
  companyName: "",
  cnpj: "",
  sectorId: "",
  exercicios: [],
  accounts: [],
  dreByExercicio: {},
  dfc: [],
  auditLog: [],
}

const NO_IDS: IdIndex = { exercicioIdByPeriodo: {}, contaIdByCode: {}, dreContaIdByLine: {} }

// Identifica na trilha de auditoria de onde veio a leitura (o parser roda no navegador, sem LLM).
export type OrigemExtracao = "leitor-pdf-local" | "digitacao-manual"
const EXTRACTION_MODEL: OrigemExtracao = "leitor-pdf-local"

// Espera o analista parar de digitar antes de gravar — senão cada tecla viraria uma requisição
// e uma linha na trilha de auditoria.
const VALUE_WRITE_DELAY_MS = 600

// A cada quanto tempo (com a aba aberta) a sessão é reconferida no servidor.
const SESSION_RECHECK_MS = 2 * 60 * 1000

async function fetchSnapshot() {
  const [me, empresa, contas, dre, dfc, auditoria] = await Promise.all([
    api<{ user: AuthUser }>("/api/auth/me"),
    api<EmpresaPayload>("/api/empresa"),
    api<{ contas: ContaNodePayload[] }>("/api/plano-de-contas"),
    api<DrePayload>("/api/dre"),
    api<DfcPayload>("/api/dfc"),
    api<AuditoriaPayload>("/api/auditoria"),
  ])
  return mapSnapshot({ me, empresa, contas, dre, dfc, auditoria })
}

function mapAccountTree(accounts: Account[], code: string, fn: (a: Account) => Account): Account[] {
  return accounts.map((account) => {
    if (account.code === code) return fn(account)
    if (account.children) return { ...account, children: mapAccountTree(account.children, code, fn) }
    return account
  })
}

const StoreContext = createContext<StoreApi | undefined>(undefined)

export function FinancialDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FinancialSnapshot>(EMPTY)
  const [status, setStatus] = useState<Status>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const ids = useRef<IdIndex>(NO_IDS)
  // Gravações do servidor entram numa fila única para chegarem na ordem em que o usuário agiu.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingWrites = useRef(0)
  const valueWrites = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>())

  const applySnapshot = useCallback((result: Awaited<ReturnType<typeof fetchSnapshot>>) => {
    ids.current = result.ids
    setData(result.snapshot)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchSnapshot()
      .then((result) => {
        if (cancelled) return
        applySnapshot(result)
        setStatus("ready")
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(errorMessage(error))
        setLoadErrorCode(error instanceof ApiError ? (error.code ?? null) : null)
        setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [applySnapshot])

  // Conta desativada, perfil rebaixado ou senha trocada em outro lugar só seriam notados na
  // próxima gravação (mudar de tela não chama a API). Reconferir a sessão ao voltar para a aba e
  // de tempos em tempos fecha essa brecha; um 401 aqui já leva ao login (ver lib/api-client.ts).
  useEffect(() => {
    if (status !== "ready") return
    const recheck = () => {
      if (document.visibilityState !== "visible") return
      api<{ user: AuthUser }>("/api/auth/me")
        .then(({ user }) => {
          // Perfil rebaixado (ou 2 etapas ligadas/desligadas) noutro lugar: a tela passa a esconder o que a pessoa não
          // pode mais fazer, sem esperar um 403 numa gravação. Mantém o mesmo objeto se nada mudou.
          setData((prev) => (JSON.stringify(prev.user) === JSON.stringify(user) ? prev : { ...prev, user }))
        })
        .catch(() => {}) // um 401 já leva ao login (api-client); outros erros passageiros ficam para a próxima conferência
    }
    const timer = setInterval(recheck, SESSION_RECHECK_MS)
    document.addEventListener("visibilitychange", recheck)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", recheck)
    }
  }, [status])

  const reload = useCallback(() => {
    setStatus("loading")
    setLoadError(null)
    setLoadErrorCode(null)
    fetchSnapshot()
      .then((result) => {
        applySnapshot(result)
        setStatus("ready")
      })
      .catch((error) => {
        setLoadError(errorMessage(error))
        setLoadErrorCode(error instanceof ApiError ? (error.code ?? null) : null)
        setStatus("error")
      })
  }, [applySnapshot])

  const refreshAccounts = useCallback(async () => {
    const { contas } = await api<{ contas: ContaNodePayload[] }>("/api/plano-de-contas")
    const { accounts, contaIdByCode } = mapContas(contas)
    ids.current = { ...ids.current, contaIdByCode }
    setData((prev) => ({ ...prev, accounts }))
  }, [])

  const refreshDre = useCallback(async () => {
    const { dreByExercicio, dreContaIdByLine } = mapDre(await api<DrePayload>("/api/dre"))
    ids.current = { ...ids.current, dreContaIdByLine }
    setData((prev) => ({ ...prev, dreByExercicio }))
  }, [])

  const refreshAudit = useCallback(async () => {
    const auditoria = await api<AuditoriaPayload>("/api/auditoria")
    setData((prev) => ({ ...prev, auditLog: mapAuditoria(auditoria) }))
  }, [])

  // Roda `task` depois de tudo que já está na fila. Em caso de erro, mostra a mensagem e volta
  // ao estado do servidor (descartando o que foi aplicado otimisticamente). Devolve undefined
  // se falhou.
  const enqueue = useCallback(
    <T,>(task: () => Promise<T>): Promise<T | undefined> => {
      pendingWrites.current++
      const result = queue.current.then(async (): Promise<T | undefined> => {
        try {
          return await task()
        } catch (error) {
          setMutationError(errorMessage(error))
          try {
            applySnapshot(await fetchSnapshot())
          } catch {
            // servidor fora do ar — mantém o que está na tela; a mensagem acima já avisa.
          }
          return undefined
        } finally {
          pendingWrites.current--
          // A trilha só é relida quando a fila esvazia, para não pedir a mesma lista a cada tecla.
          if (pendingWrites.current === 0) refreshAudit().catch(() => {})
        }
      })
      queue.current = result
      return result
    },
    [applySnapshot, refreshAudit],
  )

  const flushValueWrites = useCallback(() => {
    for (const { timer, send } of [...valueWrites.current.values()]) {
      clearTimeout(timer)
      send()
    }
  }, [])

  // Uma gravação pendente por célula (conta × exercício): a última digitada vence.
  const scheduleValueWrite = useCallback(
    (key: string, task: () => Promise<unknown>) => {
      const existing = valueWrites.current.get(key)
      if (existing) clearTimeout(existing.timer)
      const send = () => {
        valueWrites.current.delete(key)
        void enqueue(task)
      }
      valueWrites.current.set(key, { timer: setTimeout(send, VALUE_WRITE_DELAY_MS), send })
    },
    [enqueue],
  )

  useEffect(() => {
    // Fechar a aba com uma edição ainda aguardando o atraso não pode perder o lançamento.
    const onLeave = () => flushValueWrites()
    window.addEventListener("pagehide", onLeave)
    return () => {
      window.removeEventListener("pagehide", onLeave)
      flushValueWrites()
    }
  }, [flushValueWrites])

  const setSector = useCallback(
    (sectorId: string) => {
      setData((prev) => ({ ...prev, sectorId }))
      void enqueue(() => api("/api/empresa", { method: "PATCH", body: { setor: sectorLabel(sectorId) } }))
    },
    [enqueue],
  )

  const addExercicio = useCallback(
    async (label: string) => {
      flushValueWrites()
      const periodo = label.trim()
      const created = await enqueue(async () => {
        const exercicio = await api<{ id: number; periodo: string }>("/api/exercicios", {
          method: "POST",
          body: { periodo },
        })
        ids.current = {
          ...ids.current,
          exercicioIdByPeriodo: { ...ids.current.exercicioIdByPeriodo, [exercicio.periodo]: exercicio.id },
        }
        setData((prev) => ({
          ...prev,
          exercicios: [...prev.exercicios, { id: exercicio.periodo, label: exercicio.periodo, auditado: false }],
        }))
        return exercicio.periodo
      })
      return created ?? null
    },
    [enqueue, flushValueWrites],
  )

  const setExercicioAuditado = useCallback(
    (exercicioId: string, auditado: boolean) => {
      setData((prev) => ({
        ...prev,
        exercicios: prev.exercicios.map((e) => (e.id === exercicioId ? { ...e, auditado } : e)),
      }))
      void enqueue(async () => {
        const exercicioDbId = ids.current.exercicioIdByPeriodo[exercicioId]
        if (!exercicioDbId) throw new ApiError(`Exercício ${exercicioId} não encontrado.`)
        await api(`/api/exercicios/${exercicioDbId}`, { method: "PATCH", body: { auditado } })
      })
    },
    [enqueue],
  )

  const updateAccountValue = useCallback(
    (code: string, exercicioId: string, value: number | undefined) => {
      setData((prev) => ({
        ...prev,
        accounts: mapAccountTree(prev.accounts, code, (account) => {
          const values = { ...account.values }
          if (value === undefined) delete values[exercicioId]
          else values[exercicioId] = value
          return { ...account, values }
        }),
      }))
      scheduleValueWrite(`bp:${code}:${exercicioId}`, () => {
        const contaId = ids.current.contaIdByCode[code]
        const exercicioDbId = ids.current.exercicioIdByPeriodo[exercicioId]
        if (!contaId || !exercicioDbId) throw new ApiError(`Conta ${code} ou exercício ${exercicioId} não encontrado.`)
        return api("/api/valores", {
          method: "PUT",
          body: { contaId, exercicioId: exercicioDbId, valor: value ?? null },
          keepalive: true,
        })
      })
    },
    [scheduleValueWrite],
  )

  const updateDreValue = useCallback(
    (exercicioId: string, lineId: string, value: number | undefined) => {
      setData((prev) => {
        const current = { ...prev.dreByExercicio[exercicioId] }
        if (value === undefined) delete current[lineId]
        else current[lineId] = value
        return { ...prev, dreByExercicio: { ...prev.dreByExercicio, [exercicioId]: current } }
      })
      scheduleValueWrite(`dre:${lineId}:${exercicioId}`, () => {
        const contaId = ids.current.dreContaIdByLine[lineId]
        const exercicioDbId = ids.current.exercicioIdByPeriodo[exercicioId]
        if (!contaId || !exercicioDbId) throw new ApiError(`Linha ${lineId} ou exercício ${exercicioId} não encontrado.`)
        return api("/api/valores", {
          method: "PUT",
          body: { contaId, exercicioId: exercicioDbId, valor: value ?? null },
          keepalive: true,
        })
      })
    },
    [scheduleValueWrite],
  )

  const addAccountNode = useCallback(
    async (parentCode: string | null, name: string, isGroup: boolean) => {
      flushValueWrites()
      const done = await enqueue(async () => {
        const parentId = parentCode === null ? null : ids.current.contaIdByCode[parentCode]
        if (parentCode !== null && !parentId) throw new ApiError(`Conta ${parentCode} não encontrada.`)
        await api("/api/plano-de-contas", { method: "POST", body: { parentId, nome: name, ehGrupo: isGroup } })
        await refreshAccounts()
        return true
      })
      return done === true
    },
    [enqueue, flushValueWrites, refreshAccounts],
  )

  const renameAccountNode = useCallback(
    async (code: string, name: string) => {
      flushValueWrites()
      const done = await enqueue(async () => {
        const contaId = ids.current.contaIdByCode[code]
        if (!contaId) throw new ApiError(`Conta ${code} não encontrada.`)
        await api(`/api/plano-de-contas/${contaId}`, { method: "PATCH", body: { nome: name } })
        await refreshAccounts()
        return true
      })
      return done === true
    },
    [enqueue, flushValueWrites, refreshAccounts],
  )

  const deleteAccountNode = useCallback(
    async (code: string) => {
      flushValueWrites()
      const done = await enqueue(async () => {
        const contaId = ids.current.contaIdByCode[code]
        if (!contaId) throw new ApiError(`Conta ${code} não encontrada.`)
        await api(`/api/plano-de-contas/${contaId}`, { method: "DELETE" })
        await refreshAccounts()
        return true
      })
      return done === true
    },
    [enqueue, flushValueWrites, refreshAccounts],
  )

  const confirmExtraction = useCallback(
    async (exercicioId: string, entries: ExtractionEntry[], fileName: string, origem: OrigemExtracao = EXTRACTION_MODEL) => {
      flushValueWrites()
      const done = await enqueue(async () => {
        const exercicioDbId = ids.current.exercicioIdByPeriodo[exercicioId]
        if (!exercicioDbId) throw new ApiError(`Exercício ${exercicioId} não encontrado.`)
        const itens = entries.map((entry) => {
          // Código "dre:<linha>" = linha de entrada da DRE (ver lib/extraction/pdf-extraction.ts); o resto, Balanço.
          const dreLineId = entry.code === null ? null : dreLineIdFromCode(entry.code)
          const contaId =
            entry.code === null
              ? null
              : dreLineId !== null
                ? ids.current.dreContaIdByLine[dreLineId]
                : ids.current.contaIdByCode[entry.code]
          if (entry.code !== null && !contaId) throw new ApiError(`Conta ${entry.code} não encontrada.`)
          return {
            contaId,
            valor: entry.value,
            confianca: entry.confidence,
            paginaOrigem: entry.page,
            rotulo: entry.label?.slice(0, 200),
          }
        })
        await api("/api/extracoes", {
          method: "POST",
          body: { exercicioId: exercicioDbId, arquivoOrigem: fileName, modeloLlm: origem, itens },
        })
        await Promise.all([refreshAccounts(), refreshDre()])
        return true
      })
      return done === true
    },
    [enqueue, flushValueWrites, refreshAccounts, refreshDre],
  )

  const registrarParecer = useCallback(
    async (exercicioId: string, dados: NovoParecer) => {
      const done = await enqueue(async () => {
        const exercicioDbId = ids.current.exercicioIdByPeriodo[exercicioId]
        if (!exercicioDbId) throw new ApiError(`Exercício ${exercicioId} não encontrado.`)
        const parecer = await api<ParecerRegistrado>("/api/pareceres", { method: "POST", body: { exercicioId: exercicioDbId, ...dados } })
        await refreshAudit()
        return parecer
      })
      return done ?? null
    },
    [enqueue, refreshAudit],
  )

  const dismissMutationError = useCallback(() => setMutationError(null), [])

  const value = useMemo<StoreApi>(
    () => ({
      ...data,
      status,
      loadError,
      loadErrorCode,
      mutationError,
      dismissMutationError,
      reload,
      setSector,
      addExercicio,
      setExercicioAuditado,
      updateAccountValue,
      updateDreValue,
      addAccountNode,
      renameAccountNode,
      deleteAccountNode,
      confirmExtraction,
      registrarParecer,
    }),
    [
      data,
      status,
      loadError,
      loadErrorCode,
      mutationError,
      dismissMutationError,
      reload,
      setSector,
      addExercicio,
      setExercicioAuditado,
      updateAccountValue,
      updateDreValue,
      addAccountNode,
      renameAccountNode,
      deleteAccountNode,
      confirmExtraction,
      registrarParecer,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useFinancialStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error("useFinancialStore deve ser usado dentro de <FinancialDataProvider>")
  return ctx
}
