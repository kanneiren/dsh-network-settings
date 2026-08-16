/** WSL executable output helpers. `wsl.exe --list*` emits UTF-16LE text. */

export interface DecodeResult {
  text: string
  encoding: 'utf16le' | 'utf8' | 'unknown'
}

/**
 * Decode WSL.exe command output. `--list*`, `--status` and `--version` are
 * UTF-16LE (usually with BOM and CRLF); `wsl.exe -d <name> -- <linux cmd>`
 * passes through the Linux command's bytes (normally UTF-8). Callers choose
 * which family they expect.
 */
export function decodeWslUtf16(input: Uint8Array | string): DecodeResult {
  if (typeof input === 'string') return { text: stripNul(input), encoding: 'utf16le' }
  if (input.length === 0) return { text: '', encoding: 'unknown' }
  const utf16 = tryUtf16(input)
  if (utf16 !== undefined) return { text: utf16, encoding: 'utf16le' }
  return { text: stripNul(Buffer.from(input).toString('utf8')), encoding: 'utf8' }
}

function tryUtf16(bytes: Uint8Array): string | undefined {
  const hasBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const start = hasBom ? 2 : 0
  const payload = bytes.subarray(start)
  if (payload.length % 2 !== 0) return undefined
  let decoded: string
  try {
    decoded = Buffer.from(payload).toString('utf16le')
  } catch {
    return undefined
  }
  // UTF-16 output of Windows CLIs contains no NULs between characters after
  // decoding; a false-positive UTF-16 read of UTF-8 text is full of NULs.
  if (decoded.includes('\0')) return undefined
  return decoded.replace(/^\uFEFF/, '')
}

export function decodeWslCommand(input: Uint8Array | string): string {
  if (typeof input === 'string') return input
  const utf8 = Buffer.from(input).toString('utf8')
  const replacement = (utf8.match(/\uFFFD/g) ?? []).length
  if (replacement > 0) return Buffer.from(input).toString('utf16le')
  return utf8
}

function stripNul(text: string): string {
  return text.replaceAll('\0', '')
}
