import { TerminalSession } from "../../packages/runtime/src/terminal"
const t = new TerminalSession("G:/Code/Agents/Custom/newhorse")
t.humanSend("echo probe-direct-1234")
await new Promise((r) => setTimeout(r, 3000))
const r = t.read(0)
console.log(JSON.stringify({ alive: r.alive, cursor: r.cursor, textHead: r.text.slice(0, 300) }))
t.dispose()
