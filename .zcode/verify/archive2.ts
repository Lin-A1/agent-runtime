import { SqliteEventStore } from "@newhorse/core"
const store = SqliteEventStore.open("C:/Users/PC/.newhorse/data/events.db")
await store.append(process.argv[2], "Session.Archived", { sessionId: process.argv[2], archived: true, ts: Date.now() })
console.log("archived", process.argv[2])
