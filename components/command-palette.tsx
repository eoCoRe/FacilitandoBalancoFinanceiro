"use client"

import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Search } from "lucide-react"
import { can } from "@/lib/permissions"
import { buildSearchEntries, searchEntries, type SearchEntry } from "@/lib/search"
import type { ScreenId } from "@/lib/navigation"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (id: ScreenId) => void
}

// Busca rápida (⌘K / Ctrl+K): digita, escolhe com as setas e Enter, e vai para a tela, o índice ou a conta.
export function CommandPalette({ open, onOpenChange, onNavigate }: CommandPaletteProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup
          aria-label="Busca rápida"
          className="fixed left-1/2 top-[14vh] z-50 flex max-h-[70vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        >
          <Dialog.Title className="sr-only">Busca rápida</Dialog.Title>
          {/* O corpo só existe com a janela aberta: cada abertura começa com a busca vazia, sem estado a limpar. */}
          <PaletteBody
            onChoose={(entry) => {
              onOpenChange(false)
              onNavigate(entry.screen)
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Padrão "combobox" com lista: o foco fica no campo e a opção ativa é anunciada por aria-activedescendant.
function PaletteBody({ onChoose }: { onChoose: (entry: SearchEntry) => void }) {
  const { accounts, user } = useFinancialStore()
  const entries = useMemo(
    () => buildSearchEntries({ accounts, isAdmin: can(user.papel, "gerir-usuarios") }),
    [accounts, user.papel],
  )
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const results = useMemo(() => searchEntries(entries, query), [entries, query])
  const listRef = useRef<HTMLUListElement>(null)

  function move(next: number) {
    setActiveIndex(next)
    // Mantém a opção ativa à vista quando a lista rola.
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (results.length) move((activeIndex + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (results.length) move((activeIndex - 1 + results.length) % results.length)
    } else if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return // Enter que só confirma uma letra composta (IME/acento) não navega
      event.preventDefault()
      const entry = results[activeIndex]
      if (entry) onChoose(entry)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          role="combobox"
          aria-expanded
          aria-controls={results.length > 0 ? "busca-lista" : undefined}
          aria-activedescendant={results[activeIndex] ? `busca-opcao-${activeIndex}` : undefined}
          aria-label="Buscar telas, índices e contas"
          placeholder="Buscar telas, índices e contas…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          className="h-11 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
      </div>

      {results.length === 0 ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nada encontrado para “{query.trim()}”.
        </p>
      ) : (
        <ul id="busca-lista" ref={listRef} role="listbox" aria-label="Resultados" className="overflow-y-auto p-1.5">
          {results.map((entry, index) => (
            <li
              key={entry.id}
              id={`busca-opcao-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === activeIndex}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => onChoose(entry)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : "text-foreground",
              )}
            >
              <span className="flex-1 truncate">{entry.label}</span>
              {entry.kind === "Conta" && <span className="font-mono text-xs text-muted-foreground">{entry.hint}</span>}
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {entry.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
