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

// Grava (ou apaga, com undefined) o valor de uma conta num exercício. Balanço e DRE usam a mesma rota.
function putValor(contaId: number, exercicioId: number, valor: number | undefined) {
  return api("/api/valores", { method: "PUT", body: { contaId, exercicioId, valor: valor ?? null }, keepalive: true })
}

function findAccount(accounts: Account[], code: string): Account | undefined {
  for (const account of accounts) {
    if (account.code === code) return account
    const found = account.children && findAccount(account.children, code)
    if (found) return found
  }
  return undefined
}

// As telas identificam contas pelo código e exercícios pelo período; o id do banco está no próprio objeto.
function requireContaId(snapshot: FinancialSnapshot, code: string): number {
  const id = findAccount(snapshot.accounts, code)?.dbId
  if (!id) throw new ApiError(`Conta ${code} não encontrada.`)
  return id
}

function requireExercicioId(snapshot: FinancialSnapshot, periodo: string): number {
  const id = snapshot.exercicios.find((e) => e.id === periodo)?.dbId
  if (!id) throw new ApiError(`Exercício ${periodo} não encontrado.`)
  return id
}

function mapAccountTree(accounts: Account[], code: string, fn: (a: Account) => Account): Account[] {
  return accounts.map((account) => {
    if (account.code === code) return fn(account)
    if (account.children) return { ...account, children: mapAccountTree(account.children, code, fn) }
    return account
  })
}

function withAccountValue(snapshot: FinancialSnapshot, code: string, exercicioId: string, value: number | undefined): FinancialSnapshot {
  return {
    ...snapshot,
    accounts: mapAccountTree(snapshot.accounts, code, (account) => {
      const values = { ...account.values }
      if (value === undefined) delete values[exercicioId]
      else values[exercicioId] = value
      return { ...account, values }
    }),
  }
}

function withDreValue(snapshot: FinancialSnapshot, exercicioId: string, lineId: string, value: number | undefined): FinancialSnapshot {
  const current = { ...snapshot.dreByExercicio[exercicioId] }
  if (value === undefined) delete current[lineId]
  else current[lineId] = value
  return { ...snapshot, dreByExercicio: { ...snapshot.dreByExercicio, [exercicioId]: current } }
}

interface PendingValueWrite {
  timer: ReturnType<typeof setTimeout>
  send: () => void
  // Valor da célula antes da primeira edição ainda não gravada: é para ele que a tela volta se o servidor recusar.
  previous: number | undefined
}

const StoreContext = createContext<StoreApi | undefined>(undefined)

export function FinancialDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FinancialSnapshot>(EMPTY)
  const [status, setStatus] = useState<Status>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Sempre igual ao último estado: as gravações rodam depois, na fila, e leem daqui o id do banco.
  const dataRef = useRef<FinancialSnapshot>(EMPTY)
  // A DRE é fixa (linhas definidas no código), cada linha de entrada ligada a uma conta do banco.
  const dreContaIds = useRef<Record<string, number>>({})
  // Gravações do servidor entram numa fila única para chegarem na ordem em que o usuário agiu.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingWrites = useRef(0)
  const valueWrites = useRef(new Map<string, PendingValueWrite>())

  // Toda mudança do snapshot passa por aqui, para o ref acompanhar o estado sem esperar o próximo render.
  const updateData = useCallback((fn: (prev: FinancialSnapshot) => FinancialSnapshot) => {
    dataRef.current = fn(dataRef.current)
    setData(dataRef.current)
  }, [])

  const applySnapshot = useCallback(
    (result: Awaited<ReturnType<typeof fetchSnapshot>>) => {
      dreContaIds.current = result.dreContaIdByLine
      updateData(() => result.snapshot)
    },
    [updateData],
  )

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
          updateData((prev) => (JSON.stringify(prev.user) === JSON.stringify(user) ? prev : { ...prev, user }))
        })
        .catch(() => {}) // um 401 já leva ao login (api-client); outros erros passageiros ficam para a próxima conferência
    }
    const timer = setInterval(recheck, SESSION_RECHECK_MS)
    document.addEventListener("visibilitychange", recheck)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", recheck)
    }
  }, [status, updateData])

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
    const accounts = mapContas(contas)
    updateData((prev) => ({ ...prev, accounts }))
  }, [updateData])

  const refreshDre = useCallback(async () => {
    const { dreByExercicio, dreContaIdByLine } = mapDre(await api<DrePayload>("/api/dre"))
    dreContaIds.current = dreContaIdByLine
    updateData((prev) => ({ ...prev, dreByExercicio }))
  }, [updateData])

  const refreshAudit = useCallback(async () => {
    const auditoria = await api<AuditoriaPayload>("/api/auditoria")
    updateData((prev) => ({ ...prev, auditLog: mapAuditoria(auditoria) }))
  }, [updateData])

  // Roda `task` depois de tudo que já está na fila. Em caso de erro, mostra a mensagem e chama
  // `rollback`, que desfaz só o que esta tarefa aplicou na tela: edições de outras células que
  // ainda esperam para ser gravadas ficam como estão. Devolve undefined se falhou.
  const enqueue = useCallback(
    <T,>(task: () => Promise<T>, rollback?: () => void): Promise<T | undefined> => {
      pendingWrites.current++
      const result = queue.current.then(async (): Promise<T | undefined> => {
        try {
          return await task()
        } catch (error) {
          setMutationError(errorMessage(error))
          rollback?.()
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
    [refreshAudit],
  )

  const flushValueWrites = useCallback(() => {
    for (const { timer, send } of [...valueWrites.current.values()]) {
      clearTimeout(timer)
      send()
    }
  }, [])

  // Uma gravação pendente por célula (conta × exercício): a última digitada vence. Se o servidor
  // recusar, `restore` recebe o valor de antes para devolver à célula.
  const scheduleValueWrite = useCallback(
    (key: string, current: number | undefined, write: () => Promise<unknown>, restore: (previous: number | undefined) => void) => {
      const existing = valueWrites.current.get(key)
      if (existing) clearTimeout(existing.timer)
      const previous = existing ? existing.previous : current
      const send = () => {
        valueWrites.current.delete(key)
        void enqueue(write, () => {
          // Já há uma edição nova desta célula esperando: ela vai sobrescrever a tela, então só corrige o ponto de volta dela.
          const pending = valueWrites.current.get(key)
          if (pending) pending.previous = previous
          else restore(previous)
        })
      }
      valueWrites.current.set(key, { timer: setTimeout(send, VALUE_WRITE_DELAY_MS), send, previous })
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

  // Mudança estrutural: grava o que estava esperando, roda `task` na fila e relê o que mudou.
  // Nada foi aplicado na tela antes, então uma recusa não tem o que desfazer. Devolve false se falhou.
  const mutateAccounts = useCallback(
    async (task: () => Promise<unknown>, refresh: () => Promise<unknown> = refreshAccounts) => {
      flushValueWrites()
      const done = await enqueue(async () => {
        await task()
        await refresh()
        return true
      })
      return done === true
    },
    [enqueue, flushValueWrites, refreshAccounts],
  )

  const setSector = useCallback(
    (sectorId: string) => {
      const previous = dataRef.current.sectorId
      updateData((prev) => ({ ...prev, sectorId }))
      void enqueue(
        () => api("/api/empresa", { method: "PATCH", body: { setor: sectorLabel(sectorId) } }),
        () => updateData((prev) => (prev.sectorId === sectorId ? { ...prev, sectorId: previous } : prev)),
      )
    },
    [enqueue, updateData],
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
        updateData((prev) => ({
          ...prev,
          exercicios: [...prev.exercicios, { id: exercicio.periodo, label: exercicio.periodo, auditado: false, dbId: exercicio.id }],
        }))
        return exercicio.periodo
      })
      return created ?? null
    },
    [enqueue, flushValueWrites, updateData],
  )

  const setExercicioAuditado = useCallback(
    (exercicioId: string, auditado: boolean) => {
      const setAuditado = (value: boolean) =>
        updateData((prev) => ({
          ...prev,
          exercicios: prev.exercicios.map((e) => (e.id === exercicioId ? { ...e, auditado: value } : e)),
        }))
      setAuditado(auditado)
      void enqueue(
        () => api(`/api/exercicios/${requireExercicioId(dataRef.current, exercicioId)}`, { method: "PATCH", body: { auditado } }),
        () => setAuditado(!auditado),
      )
    },
    [enqueue, updateData],
  )

  const updateAccountValue = useCallback(
    (code: string, exercicioId: string, value: number | undefined) => {
      const cell = () => findAccount(dataRef.current.accounts, code)?.values?.[exercicioId]
      const current = cell()
      updateData((prev) => withAccountValue(prev, code, exercicioId, value))
      scheduleValueWrite(
        `bp:${code}:${exercicioId}`,
        current,
        () => putValor(requireContaId(dataRef.current, code), requireExercicioId(dataRef.current, exercicioId), value),
        (previous) => {
          if (cell() === value) updateData((prev) => withAccountValue(prev, code, exercicioId, previous))
        },
      )
    },
    [scheduleValueWrite, updateData],
  )

  const updateDreValue = useCallback(
    (exercicioId: string, lineId: string, value: number | undefined) => {
      const cell = () => dataRef.current.dreByExercicio[exercicioId]?.[lineId]
      const current = cell()
      updateData((prev) => withDreValue(prev, exercicioId, lineId, value))
      scheduleValueWrite(
        `dre:${lineId}:${exercicioId}`,
        current,
        () => {
          const contaId = dreContaIds.current[lineId]
          if (!contaId) throw new ApiError(`Linha ${lineId} não encontrada.`)
          return putValor(contaId, requireExercicioId(dataRef.current, exercicioId), value)
        },
        (previous) => {
          if (cell() === value) updateData((prev) => withDreValue(prev, exercicioId, lineId, previous))
        },
      )
    },
    [scheduleValueWrite, updateData],
  )

  const addAccountNode = useCallback(
    (parentCode: string | null, name: string, isGroup: boolean) =>
      mutateAccounts(() => {
        const parentId = parentCode === null ? null : requireContaId(dataRef.current, parentCode)
        return api("/api/plano-de-contas", { method: "POST", body: { parentId, nome: name, ehGrupo: isGroup } })
      }),
    [mutateAccounts],
  )

  const renameAccountNode = useCallback(
    (code: string, name: string) =>
      mutateAccounts(() => api(`/api/plano-de-contas/${requireContaId(dataRef.current, code)}`, { method: "PATCH", body: { nome: name } })),
    [mutateAccounts],
  )

  const deleteAccountNode = useCallback(
    (code: string) => mutateAccounts(() => api(`/api/plano-de-contas/${requireContaId(dataRef.current, code)}`, { method: "DELETE" })),
    [mutateAccounts],
  )

  const confirmExtraction = useCallback(
    (exercicioId: string, entries: ExtractionEntry[], fileName: string, origem: OrigemExtracao = EXTRACTION_MODEL) =>
      mutateAccounts(
        () => {
          const snapshot = dataRef.current
          const itens = entries.map((entry) => {
            // Código "dre:<linha>" = linha de entrada da DRE (ver lib/extraction/pdf-extraction.ts); o resto, Balanço.
            const dreLineId = entry.code === null ? null : dreLineIdFromCode(entry.code)
            let contaId: number | null = null
            if (dreLineId !== null) {
              contaId = dreContaIds.current[dreLineId] ?? null
              if (!contaId) throw new ApiError(`Conta ${entry.code} não encontrada.`)
            } else if (entry.code !== null) {
              contaId = requireContaId(snapshot, entry.code)
            }
            return {
              contaId,
              valor: entry.value,
              confianca: entry.confidence,
              paginaOrigem: entry.page,
              rotulo: entry.label?.slice(0, 200),
            }
          })
          return api("/api/extracoes", {
            method: "POST",
            body: { exercicioId: requireExercicioId(snapshot, exercicioId), arquivoOrigem: fileName, modeloLlm: origem, itens },
          })
        },
        () => Promise.all([refreshAccounts(), refreshDre()]),
      ),
    [mutateAccounts, refreshAccounts, refreshDre],
  )

  const registrarParecer = useCallback(
    async (exercicioId: string, dados: NovoParecer) => {
      const done = await enqueue(async () => {
        const parecer = await api<ParecerRegistrado>("/api/pareceres", {
          method: "POST",
          body: { exercicioId: requireExercicioId(dataRef.current, exercicioId), ...dados },
        })
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
