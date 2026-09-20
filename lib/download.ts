// Baixa um texto como arquivo, no navegador, sem passar pelo servidor. O conteúdo já vem pronto (com BOM, no
// caso de CSV); o Blob o preserva byte a byte.
export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Solta a URL depois que o navegador já iniciou o download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
