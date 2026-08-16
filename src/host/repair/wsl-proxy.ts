/** WSL proxy line repair: backup + exact-line removal inside a distro. */
import { runWslScript } from '../probe/wsl.ts'
import { inspectWslProxySources, parseProxySources, type WslProxySource } from '../wsl/sources.ts'
import { saveSnapshot, updateSnapshotAfter, type SnapshotScope } from '../snapshot/store.ts'
import { diffJson, summarizeDiff } from '../snapshot/diff.ts'

export interface WslProxyPreview {
  distribution: string
  file: string
  line: number
  raw: string
  scopeDescription: string
  diffText: string[]
}

export interface WslProxyApplyResult extends WslProxyPreview {
  snapshotId: string
}

function fileKey(file: string): string {
  return Buffer.from(file).toString('base64url')
}

function snapshotScope(source: WslProxySource): SnapshotScope {
  return `wsl.${source.distribution}.${fileKey(source.file)}`
}

export function previewWslProxySource(source: WslProxySource): WslProxyPreview {
  return {
    distribution: source.distribution,
    file: source.file,
    line: source.line,
    raw: source.raw,
    scopeDescription: `只会删除 ${source.distribution} 中 ${source.file} 的第 ${source.line} 行（改前自动备份）。不会修改 Windows、其他 WSL 发行版或其他文件。`,
    diffText: [`${source.file}:${source.line}: ${source.raw} → (删除)`],
  }
}

async function ensureSource(distribution: string, file: string, line: number): Promise<void> {
  const sources = await inspectWslProxySources(distribution)
  if (!sources.some(source => source.file === file && source.line === line)) {
    throw new Error(`未在 ${distribution} 的 ${file}:${line} 找到代理配置行`)
  }
}

export async function applyWslProxySource(source: WslProxySource): Promise<WslProxyApplyResult> {
  await ensureSource(source.distribution, source.file, source.line)
  const backup = `${source.file}.dsh-network-settings.bak`
  const scope = snapshotScope(source)
  const snapshot = await saveSnapshot({
    reason: `删除 WSL 代理行: ${source.distribution} ${source.file}:${source.line}`,
    scope,
    before: {
      distribution: source.distribution,
      file: source.file,
      line: source.line,
      raw: source.raw,
      backup,
    },
    reversible: true,
  })

  const rawBase64 = Buffer.from(source.value, 'utf8').toString('base64')
  const script = [
    `set -eu`,
    `backup='${backup}'`,
    `file='${source.file}'`,
    `line='${source.line}'`,
    `expected='${rawBase64}'`,
    `cp -p "$file" "$backup"`,
    `python3 - "$file" "$line" "$expected" <<'PY'`,
    `import base64, pathlib, sys`,
    `file, line, expected_b64 = sys.argv[1], int(sys.argv[2]), sys.argv[3]`,
    `lines = pathlib.Path(file).read_text().splitlines()`,
    `expected = base64.b64decode(expected_b64).decode('utf-8')`,
    `if line < 1 or line > len(lines) or lines[line - 1] != expected:`,
    `    raise SystemExit(2)`,
    `del lines[line - 1]`,
    `pathlib.Path(file).write_text('\\n'.join(lines) + '\\n')`,
    `PY`,
  ].join('\n')

  const result = await runWslScript(source.distribution, script, { timeoutMs: 10_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `删除代理行失败: ${result.stdout.trim()}`)
  await updateSnapshotAfter(snapshot.id, { distribution: source.distribution, file: source.file, line: null, backup })

  return {
    ...previewWslProxySource(source),
    snapshotId: snapshot.id,
  }
}

export async function rollbackWslSnapshot(scope: SnapshotScope, snapshot: {
  before: unknown
  after?: unknown
}): Promise<{ diffText: string[] }> {
  const before = snapshot.before as { distribution?: string; file?: string; line?: number; backup?: string }
  if (before.distribution === undefined || before.file === undefined || before.backup === undefined) {
    throw new Error('WSL 快照缺少恢复信息')
  }
  const script = [
    `set -eu`,
    `backup='${before.backup}'`,
    `file='${before.file}'`,
    `[ -f "$backup" ] || { echo "backup missing: $backup" >&2; exit 2; }`,
    `cp -p "$backup" "$file"`,
  ].join('\n')
  const result = await runWslScript(before.distribution, script, { timeoutMs: 10_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '恢复 WSL 文件失败')
  return { diffText: [`${before.file}:${before.line ?? '?'} 已从备份恢复`] }
}

/** Test seam: parse attribution output. */
export { parseProxySources }
