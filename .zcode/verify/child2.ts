import { SqliteEventStore } from "@newhorse/core"
const store = SqliteEventStore.open("C:/Users/PC/.newhorse/data/events.db")
const child = crypto.randomUUID()
await store.append(child, "Session.Created", { id: child, location: "G:/Code/Agents/Custom/newhorse", createdAt: Date.now() })
await store.append(child, "Session.Spawned", { sessionId: child, parentId: process.argv[2], via: "spawn" })
console.log(child)
