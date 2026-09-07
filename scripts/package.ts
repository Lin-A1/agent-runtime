/**
 * Package the runtime server into a self-contained executable.
 *
 *   bun run scripts/package.ts                 # → dist/newhorse-server(.exe)
 *   bun run scripts/package.ts --with-ui       # also copy ./ui (built web client)
 *
 * NO bundler config: `bun build --compile` walks imports from main.ts and
 * embeds the engine (core/schema/llm/plugin/runtime/memory/mcp/server). The
 * result is ONE binary — no node_modules, no bun, no src tree required at the
 * destination. UI is NOT embedded in the binary (Bun.file reads the fs path);
 * --with-ui copies the built client next to the exe and the operator points
 * NEWHORSE_UI_DIR at it (or the packaged launcher does).
 *
 * Environment stays external by design: the engine resolves provider/model/
 * mcpServers/memory from ~/.newhorse/config.json at runtime, so a packaged
 * binary + one config file is the whole install surface.
 */
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const outDir = join(root, "dist")
const exeName = process.platform === "win32" ? "newhorse-server.exe" : "newhorse-server"
const withUi = process.argv.includes("--with-ui")

mkdirSync(outDir, { recursive: true })

// 1. Build the single binary.
console.log(`[package] bun build --compile ${join("packages", "server", "src", "main.ts")}`)
const build = spawn(
  "bun",
  ["build", "--compile", join("packages", "server", "src", "main.ts"), "--outfile", join(outDir, exeName)],
  { stdio: "inherit", cwd: root },
)
await new Promise<void>((resolveExit, reject) => {
  build.on("exit", (code) => (code === 0 ? resolveExit() : reject(new Error(`build failed (exit ${code})`))))
})
const binPath = join(outDir, exeName)
console.log(`[package] binary  : ${binPath} (${Math.round(statSync(binPath).size / 1024 / 1024)} MB)`)

// 2. Optionally stage the web UI next to the binary (ui/).
if (withUi) {
  const uiSrc = join(root, "ui")
  if (!existsSync(join(uiSrc, "index.html"))) {
    console.warn(`[package] skip ui: no build at ${uiSrc} (build the web client there first)`)
  } else {
    const uiOut = join(outDir, "ui")
    cpSync(uiSrc, uiOut, { recursive: true })
    console.log(`[package] ui      : ${uiOut}`)
  }
}

console.log(`[package] done    : ${binPath}`)
console.log(`[package] run     : ${binPath}  (config in ~/.newhorse/config.json)`)
