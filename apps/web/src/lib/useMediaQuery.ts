import { useEffect, useState } from "react"

export function observeMediaQuery(media: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">, update: (matches: boolean) => void): () => void {
  const onChange = () => update(media.matches)
  media.addEventListener("change", onChange)
  onChange()
  return () => media.removeEventListener("change", onChange)
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => observeMediaQuery(window.matchMedia(query), setMatches), [query])
  return matches
}
