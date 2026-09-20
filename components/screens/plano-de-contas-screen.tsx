"use client"

import { useState } from "react"
import { Check, ChevronRight, FolderPlus, Pencil, Plus, Trash2, X } from "lucide-react"
import { GlossaryTerm } from "@/components/glossary-term"
import { PageHeader } from "@/components/page-header"
import { ScaleToggle } from "@/components/scale-toggle"
import { Button } from "@/components/ui/button"
import { can } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import { flattenAccounts, formatScaled, sumAccount, type Account, type Scale } from "@/lib/financial-data"
import { cn } from "@/lib/utils"

interface DraftState {
  parentCode: string | null
  isGroup: boolean
}

interface TreeRowProps {
  readOnly: boolean
  account: Account
  depth: number
  expanded: Set<string>
  onToggle: (code: string) => void
  editingCode: string | null
  onStartEdit: (code: string) => void
  onCommitEdit: (code: string, name: string) => void
  onCancelEdit: () => void
  onDelete: (code: string) => void
  draft: DraftState | null
  onStartDraft: (parentCode: string | null, isGroup: boolean) => void
  onCommitDraft: (name: string) => void
  onCancelDraft: () => void
}

function TreeRow(props: TreeRowProps) {
  const {
    readOnly,
    account,
    depth,
    expanded,
    onToggle,
    editingCode,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onDelete,
    draft,
    onStartDraft,
    onCommitDraft,
    onCancelDraft,
  } = props
  const hasChildren = !!account.children
  const hasChildItems = !!account.children?.length
  const isOpen = expanded.has(account.code)
  const isRoot = depth === 0
  const isEditing = editingCode === account.code
  const [nameDraft, setNameDraft] = useState(account.name)
  const [draftName, setDraftName] = useState("")

  const showDraftHere = draft?.parentCode === account.code

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md py-1.5 pr-2 transition-colors hover:bg-primary/[0.04]",
          isRoot && "bg-primary/[0.03]",
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(account.code)}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? "Recolher" : "Expandir"}
            aria-expanded={isOpen}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{account.code}</span>

        {isEditing ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitEdit(account.code, nameDraft)
              if (e.key === "Escape") onCancelEdit()
            }}
            onBlur={() => onCommitEdit(account.code, nameDraft)}
            className="flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
          />
        ) : (
          <GlossaryTerm
            term={account.name}
            className={cn(
              "flex-1 truncate text-sm",
              isRoot ? "font-semibold text-foreground" : hasChildren ? "font-medium text-foreground" : "text-foreground",
            )}
          />
        )}

        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            hasChildren ? "bg-muted text-muted-foreground" : "border border-border text-muted-foreground",
          )}
        >
          {hasChildren ? "Grupo" : "Analítica"}
        </span>

        {!readOnly && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onStartEdit(account.code)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Renomear ${account.name}`}
          >
            <Pencil className="size-3.5" />
          </button>
          {hasChildren && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!isOpen) onToggle(account.code)
                  onStartDraft(account.code, false)
                }}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Adicionar conta analítica em ${account.name}`}
                title="Adicionar conta analítica"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isOpen) onToggle(account.code)
                  onStartDraft(account.code, true)
                }}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Adicionar subgrupo em ${account.name}`}
                title="Adicionar subgrupo"
              >
                <FolderPlus className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onDelete(account.code)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-risk-muted hover:text-risk"
            aria-label={`Excluir ${account.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        )}
      </div>

      {hasChildItems &&
        isOpen &&
        account.children!.map((child) => (
          <TreeRow key={child.code} {...props} account={child} depth={depth + 1} />
        ))}

      {showDraftHere && (
        <div className="flex items-center gap-2 rounded-md bg-primary/[0.04] py-1.5 pr-2" style={{ paddingLeft: `${(depth + 1) * 20 + 8 + 20}px` }}>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onCommitDraft(draftName)
                setDraftName("")
              }
              if (e.key === "Escape") onCancelDraft()
            }}
            placeholder={draft?.isGroup ? "Nome do subgrupo" : "Nome da conta analítica"}
            className="flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
          />
          <button
            type="button"
            onClick={() => {
              onCommitDraft(draftName)
              setDraftName("")
            }}
            className="flex size-6 items-center justify-center rounded text-ok hover:bg-ok-muted"
            aria-label="Confirmar"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onCancelDraft}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            aria-label="Cancelar"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </>
  )
}

function flattenForPreview(accounts: Account[], depth = 0): { account: Account; depth: number }[] {
  return accounts.flatMap((account) => [
    { account, depth },
    ...(account.children ? flattenForPreview(account.children, depth + 1) : []),
  ])
}

function PreviewRow({ account, depth, scale, period }: { account: Account; depth: number; scale: Scale; period: string }) {
  const hasChildren = !!account.children?.length
  const isRoot = depth === 0
  return (
    <tr className={cn("border-b border-border last:border-0", isRoot && "bg-primary/[0.03]")}>
      <td className="py-1.5 pr-2 text-xs" style={{ paddingLeft: `${depth * 14 + 12}px` }}>
        <GlossaryTerm
          term={account.name}
          className={cn("text-foreground", isRoot ? "font-semibold" : hasChildren ? "font-medium" : "text-muted-foreground")}
        />
      </td>
      <td className={cn("py-1.5 pr-3 text-right font-mono text-xs tabular-nums", hasChildren ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {formatScaled(sumAccount(account, period), scale)}
      </td>
    </tr>
  )
}

export function PlanoDeContasScreen() {
  const store = useFinancialStore()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["1", "1.1", "2", "2.1", "2.3"]))
  const [scale, setScale] = useState<Scale>("milhares")
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [rootDraftName, setRootDraftName] = useState("")

  const canManage = can(store.user.papel, "gerir-plano-de-contas")
  const latestPeriod = store.exercicios[store.exercicios.length - 1]?.id ?? ""

  const toggle = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const handleCommitEdit = (code: string, name: string) => {
    if (name.trim()) store.renameAccountNode(code, name.trim())
    setEditingCode(null)
  }

  const handleDelete = (code: string) => {
    const flat = flattenAccounts(store.accounts)
    const node = flat.find((r) => r.account.code === code)?.account
    const label = node?.name ?? code
    if (confirm(`Excluir "${label}" e todas as suas subcontas? Os valores lançados serão perdidos.`)) {
      store.deleteAccountNode(code)
    }
  }

  const handleCommitDraft = (name: string) => {
    if (name.trim() && draft) {
      store.addAccountNode(draft.parentCode, name.trim(), draft.isGroup)
    }
    setDraft(null)
    setRootDraftName("")
  }

  const previewRows = flattenForPreview(store.accounts)

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Estrutura"
        title="Plano de Contas"
        subtitle={
          canManage
            ? "Organize a hierarquia de contas contábeis que estrutura a tabulação."
            : "Hierarquia de contas contábeis que estrutura a tabulação. Só coordenadores e administradores podem alterá-la."
        }
        actions={
          <>
            <ScaleToggle value={scale} onChange={setScale} />
            {canManage && (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft({ parentCode: null, isGroup: true })}>
                <FolderPlus className="size-3.5" />
                Grupo raiz
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[1fr_384px]">
        {/* Árvore */}
        <div className="border-b border-border px-4 md:px-8 py-6 xl:border-b-0 xl:border-r">
          <div className="rounded-md border border-border bg-card p-2">
            {store.accounts.map((account) => (
              <TreeRow
                key={account.code}
                readOnly={!canManage}
                account={account}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                editingCode={editingCode}
                onStartEdit={setEditingCode}
                onCommitEdit={handleCommitEdit}
                onCancelEdit={() => setEditingCode(null)}
                onDelete={handleDelete}
                draft={draft}
                onStartDraft={(parentCode, isGroup) => setDraft({ parentCode, isGroup })}
                onCommitDraft={handleCommitDraft}
                onCancelDraft={() => setDraft(null)}
              />
            ))}

            {draft?.parentCode === null && (
              <div className="flex items-center gap-2 rounded-md bg-primary/[0.04] py-1.5 pr-2 pl-4">
                <input
                  autoFocus
                  value={rootDraftName}
                  onChange={(e) => setRootDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitDraft(rootDraftName)
                    if (e.key === "Escape") {
                      setDraft(null)
                      setRootDraftName("")
                    }
                  }}
                  placeholder="Nome do grupo raiz"
                  className="flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCommitDraft(rootDraftName)}
                  className="flex size-6 items-center justify-center rounded text-ok hover:bg-ok-muted"
                  aria-label="Confirmar"
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null)
                    setRootDraftName("")
                  }}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label="Cancelar"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Passe o mouse sobre uma linha para renomear, adicionar subconta ou excluir. Contas analíticas recebem
            valores na Tabulação.
          </p>
        </div>

        {/* Preview */}
        <aside className="px-4 md:px-8 py-6 xl:px-6">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview da Tabulação</p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">Estrutura como tabela — {latestPeriod || "sem exercício"}</h2>
          <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pl-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Conta
                  </th>
                  <th className="py-2 pr-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {latestPeriod}
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map(({ account, depth }) => (
                  <PreviewRow key={account.code} account={account} depth={depth} scale={scale} period={latestPeriod} />
                ))}
              </tbody>
            </table>
          </div>
        </aside>
      </div>
    </div>
  )
}
