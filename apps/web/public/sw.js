/* newhorse service worker — MINIMAL installability + network-first shell.
 * Deliberately no aggressive caching: the app is a thin client over a live
 * SSE API; stale HTML would pin old bundle references. The SW exists so the
 * browser treats the installed PWA as a first-class app (Android install
 * prompt, iOS home-screen standalone). */
const SHELL = "newhorse-shell-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["./", "./manifest.webmanifest"])).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== "GET" || url.pathname.startsWith("/v1/")) return // API: never cache
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Refresh the shell cache in the background for navigations only.
        if (event.request.mode === "navigate") {
          const copy = res.clone()
          caches.open(SHELL).then((cache) => cache.put("./index.html", copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(event.request.mode === "navigate" ? "./index.html" : event.request)),
  )
})
