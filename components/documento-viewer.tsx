"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { carregarPdfjs } from "@/lib/extraction/pdf-text"

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_PASSO = 0.25

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

// Mostra o documento enviado (PDF ou imagem) para o analista digitar os valores olhando para ele. Tudo no navegador:
// o arquivo não vai a lugar nenhum. PDF e imagem são desenhados num canvas (a CSP não permite PDF num iframe, e assim
// nenhum dado do arquivo vira atributo da página).
export function DocumentoViewer({ file }: { file: File }) {
  const [zoom, setZoom] = useState(1)
  const pdf = isPdf(file)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={file.name}>
          {file.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASSO))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Diminuir zoom"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASSO))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Aumentar zoom"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{pdf ? <PaginasPdf file={file} zoom={zoom} /> : <Imagem file={file} zoom={zoom} />}</div>
    </div>
  )
}

// A imagem é decodificada (createImageBitmap) e desenhada num canvas, como as páginas do PDF: nenhum dado do arquivo
// vira atributo da página (um <img src="blob:..."> foi apontado pelo CodeQL como texto do usuário reinterpretado).
function Imagem({ file, zoom }: { file: File; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let cancelado = false
    createImageBitmap(file)
      .then((bitmap) => {
        const alvo = canvas.current
        if (cancelado || !alvo) return bitmap.close()
        alvo.width = bitmap.width
        alvo.height = bitmap.height
        alvo.getContext("2d")?.drawImage(bitmap, 0, 0)
        bitmap.close()
      })
      .catch(() => !cancelado && setErro(true))
    return () => {
      cancelado = true
    }
  }, [file])

  if (erro) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível mostrar esta imagem aqui. Abra-a em outro programa e digite os valores ao lado.</p>
  }
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={`Documento ${file.name}`}
      style={{ width: `${zoom * 100}%` }}
      className="mx-auto block max-w-none bg-white shadow-sm"
    />
  )
}

function PaginasPdf({ file, zoom }: { file: File; zoom: number }) {
  const container = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando")

  useEffect(() => {
    let cancelado = false
    let destruir: (() => Promise<void>) | undefined
    const alvo = container.current
    ;(async () => {
      try {
        const pdfjsLib = await carregarPdfjs()
        const tarefa = pdfjsLib.getDocument({ data: await file.arrayBuffer() })
        destruir = () => tarefa.destroy()
        const doc = await tarefa.promise
        if (cancelado || !alvo) return
        alvo.replaceChildren()
        // -2: a borda/sombra da página não pode gerar rolagem horizontal no zoom de 100%
        const largura = (alvo.clientWidth || 600) - 2
        const densidade = window.devicePixelRatio || 1
        for (let n = 1; n <= doc.numPages && !cancelado; n++) {
          const pagina = await doc.getPage(n)
          const base = pagina.getViewport({ scale: 1 })
          // zoom 100% = página na largura do painel
          const escala = (largura / base.width) * zoom
          const viewport = pagina.getViewport({ scale: escala * densidade })
          const canvas = document.createElement("canvas")
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(viewport.width / densidade)}px`
          canvas.className = "mx-auto mb-3 block bg-white shadow-sm"
          canvas.setAttribute("aria-label", `Página ${n} de ${doc.numPages}`)
          alvo.appendChild(canvas)
          await pagina.render({ canvas, viewport }).promise
          // A primeira página já está na tela: some o "Abrindo…" (as outras seguem aparecendo).
          if (n === 1 && !cancelado) setEstado("pronto")
        }
      } catch {
        if (!cancelado) setEstado("erro")
      }
    })()
    return () => {
      cancelado = true
      destruir?.().catch(() => {})
    }
  }, [file, zoom])

  return (
    <>
      {estado === "carregando" && (
        <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Abrindo o documento…
        </p>
      )}
      {estado === "erro" && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível mostrar este PDF aqui (arquivo corrompido ou protegido por senha). Abra-o em outro programa e
          digite os valores ao lado.
        </p>
      )}
      <div ref={container} />
    </>
  )
}
