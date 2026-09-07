/**
 * Pre-compile npx-launched MCP servers into self-contained executables so a
 * packaged machine needs no Node/npx for them.
 *
 *   bun run scripts/prebuild-mcp.ts --config ~/.newhorse/config.json
 *
 * For each enabled stdio MCP server whose command is `npx`, the script
 * installs the package, bun-builds its entry into a single exe under
 * `dist/mcp/<name>.exe`, and rewrites the config to point at it (a backup of
 * the original config is left as config.json.bak). Servers that cannot be
 * bundled (native modules, non-JS) are left as npx and reported.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dir, "..")
const argv = process.argv
const configArg =
  argv.find((a) => a.startsWith("--config="))?.slice("--config=".length) ??
  argv[argv.indexOf("--config") + 1] ?? undefined
// resolve() mangles drive-letter paths like C:/x on Windows; keep absolute
// paths as-is and only default to the agent home when nothing is passed.
const configPath = configArg ? (isAbsolute(configArg) ? configArg : resolve(configArg)) : join(homedir(), ".newhorse", "config.json")
const outDir = join(root, "dist", "mcp")
mkdirSync(outDir, { recursive: true })

const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  mcpServers?: Record<string, { command?: string; args?: string[]; enabled?: boolean }>
}
const servers = config.mcpServers ?? {}

if (Object.keys(servers).length === 0) {
  console.log("[prebuild] no mcpServers configured — nothing to do")
  process.exit(0)
}

const results: Array<{ name: string; ok: boolean; detail: string }> = []
for (const [name, cfg] of Object.entries(servers)) {
  if (cfg.enabled === false) continue
  if (cfg.command !== "npx" && cfg.command !== "npm exec") {
    results.push({ name, ok: false, detail: `not npx (${cfg.command ?? "?"}) — left as-is` })
    continue
  }
  // npx -y <pkg> [args...] → the package name is the first arg after -y
  const args = (cfg.args ?? []).filter((a) => a !== "-y").filter((a) => !a.startsWith("--"))
  const pkg = args[0]
  if (!pkg || !/^[\w@./-]+$/.test(pkg)) {
    results.push({ name, ok: false, detail: `cannot determine package from ${JSON.stringify(cfg)}` })
    continue
  }
  // Install OUTSIDE the repo tree: npm walks up package.json, and a
  // workspaces:*-style root turns `npm install <pkg>` into a protocol error.
  const tmp = join(tmpdir(), `nh-mcp-${name}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const install = spawnSync("npm", ["install", pkg], { cwd: tmp, stdio: "pipe" })
  const pkgJsonPath = findEntry(join(tmp, "node_modules", pkg))
  if (!pkgJsonPath) {
    results.push({ name, ok: false, detail: `npm install ${pkg} failed or no entry` })
    continue
  }
  const exe = join(outDir, `${name}.exe`)
  const build = spawnSync(
    "bun",
    ["build", "--compile", "--target=bun-windows-x64", pkgJsonPath, "--outfile", exe],
    { cwd: tmp, stdio: "pipe" },
  )
  if (build.status !== 0 || !existsSync(exe)) {
    results.push({ name, ok: false, detail: `bun compile failed: ${String(build.stderr ?? "").slice(0, 120)}` })
    continue
  }
  // Rewrite the config in place: command → the built exe.
  const size = existsSync(exe) ? statSync(exe).size : 0
  cfg.command = exe
  cfg.args = []
  ;(servers[name] as { command: string; args: string[] }) = cfg
  results.push({ name, ok: true, detail: `→ ${exe} (${Math.round(size / 1024 / 1024)}MB)` })
}

// Write the rewritten config only when at least one server was rebundled.
if (results.some((r) => r.ok)) {
  spawnSync("cp", [configPath, `${configPath}.bak`])
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}
for (const r of results) console.log(`[prebuild] ${r.name}: ${r.ok ? "OK" : "SKIP"} — ${r.detail}`)

function findEntry(base: string): string | undefined {
  const pkgJson = join(base, "package.json")
  if (!existsSync(pkgJson)) return undefined
  const { bin, main } = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string>; main?: string }
  const entry = typeof bin === "string" ? bin : bin && Object.values(bin)[0]
  const candidate = join(base, entry ?? main ?? "index.js")
  return existsSync(candidate) ? candidate : undefined
}
