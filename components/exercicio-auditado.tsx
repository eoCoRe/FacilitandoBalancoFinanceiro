import { cn } from "@/lib/utils"

// Selo "Auditado / Não auditado" do exercício. Só informa (não bloqueia edição); quem tem permissão vê
// o botão para alternar. O botão tem o texto na cor normal e sublinhado (contraste e não depender só de cor).
export function ExercicioAuditado({
  auditado,
  canToggle,
  onToggle,
}: {
  auditado: boolean
  canToggle: boolean
  onToggle: (auditado: boolean) => void
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          auditado ? "bg-ok-muted text-ok" : "bg-muted text-muted-foreground",
        )}
      >
        {auditado ? "Auditado" : "Não auditado"}
      </span>
      {canToggle && (
        <button
          type="button"
          onClick={() => onToggle(!auditado)}
          className="inline-flex min-h-6 items-center text-xs text-foreground underline underline-offset-4 hover:decoration-2"
        >
          {auditado ? "Desmarcar" : "Marcar como auditado"}
        </button>
      )}
    </span>
  )
}
