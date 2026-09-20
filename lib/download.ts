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

// Nome do arquivo em `Content-Disposition: attachment; filename="x.csv"` (ou `filename*=`); `fallback` se não houver.
export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim())
    } catch {
      // cai para o nome simples
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  return plain ? plain[1].trim() : fallback
}

// Baixa um arquivo gerado pelo servidor (exportação, "meus dados") por fetch, em vez de navegar até o endereço: se a
// sessão expirou, o limite de exportações foi atingido ou a permissão mudou, a pessoa recebe uma MENSAGEM na tela — uma
// navegação trocaria o app inteiro por um JSON de erro cru e perderia o que estava na tela. O cookie de sessão vai junto
// (mesma origem) e o servidor continua conferindo a permissão.
export async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { credentials: "same-origin" })
  if (!response.ok) {
    let message = "Não foi possível baixar o arquivo."
    if (response.status === 401) message = "Sua sessão expirou. Entre novamente."
    else if (response.status === 403) message = "Você não tem permissão para baixar este arquivo."
    else if (response.status === 429) message = "Muitas tentativas. Aguarde alguns minutos e tente de novo."
    else {
      try {
        const body = (await response.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // sem JSON: fica a mensagem padrão
      }
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filenameFromContentDisposition(response.headers.get("content-disposition"), fallbackName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

