import { inflateRawSync } from "node:zlib"

// Lê um arquivo de dentro de um ZIP (sem dependência: só o zlib do Node). Suficiente para os ZIPs de dados abertos
// da CVM: arquivos "stored" (0) ou "deflate" (8), sem ZIP64 (cada arquivo tem bem menos de 4 GB).
export function lerArquivoDoZip(zip: Buffer, nome: string): Buffer | null {
  // Fim do diretório central: assinatura 0x06054b50, nos últimos 22 bytes + até 64 KB de comentário.
  let fim = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error("ZIP inválido: fim do diretório central não encontrado.")

  const total = zip.readUInt16LE(fim + 10)
  let p = zip.readUInt32LE(fim + 16)
  for (let k = 0; k < total; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP inválido: entrada do diretório central corrompida.")
    const metodo = zip.readUInt16LE(p + 10)
    const tamanhoComprimido = zip.readUInt32LE(p + 20)
    const tamNome = zip.readUInt16LE(p + 28)
    const tamExtra = zip.readUInt16LE(p + 30)
    const tamComentario = zip.readUInt16LE(p + 32)
    const cabecalhoLocal = zip.readUInt32LE(p + 42)
    if (zip.toString("utf8", p + 46, p + 46 + tamNome) === nome) {
      const inicio = cabecalhoLocal + 30 + zip.readUInt16LE(cabecalhoLocal + 26) + zip.readUInt16LE(cabecalhoLocal + 28)
      const dados = zip.subarray(inicio, inicio + tamanhoComprimido)
      if (metodo === 0) return dados
      if (metodo === 8) return inflateRawSync(dados)
      throw new Error(`ZIP: método de compressão ${metodo} não suportado (${nome}).`)
    }
    p += 46 + tamNome + tamExtra + tamComentario
  }
  return null
}
