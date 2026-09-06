import { SqliteEventStore } from "@newhorse/core"
const store = SqliteEventStore.open("C:/Users/PC/.zcode/cli/tmp/nh-verify/data/events.db")
// 等价于 close_agent 的 archiveTarget 效果：追加 Session.Archived
await store.append(process.argv[2], "Session.Archived", { sessionId: process.argv[2], archived: true, ts: Date.now() })
console.log("archived", process.argv[2])
