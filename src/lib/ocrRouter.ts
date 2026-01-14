// src/lib/ocrRouter.ts
import { getOcrOnlineEnabled } from "./ocrSettings"
function logOcrRoute(kind: "single" | "multi", online: boolean) {
  // log simple + event pour debug (sans casser en prod)
  try {
    console.log(`[ocrRouter] route=${online ? "ONLINE" : "OFFLINE"} kind=${kind}`)
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent("lim:ocr-route", { detail: { online, kind, ts: Date.now() } })
    )
  } catch {}
}

type MultiResult = {
  pagesText: string[]
  layout: Array<{ page: number; items: any[] }>
}

export async function ocrFallback(file: File): Promise<string> {
  const online = getOcrOnlineEnabled()
  logOcrRoute("single", online)

  if (online) {
    const mod = await import("./ocrFallback")
    return mod.ocrFallback(file)
  } else {
    const mod = await import("./ocrLocalFallback")
    return mod.ocrFallback(file)
  }
}


export async function ocrFallbackMultiWithLayout(
  file: File,
  pageCount: number
): Promise<MultiResult> {
  const online = getOcrOnlineEnabled()
  logOcrRoute("multi", online)

  if (online) {
    const mod = await import("./ocrFallback")
    return mod.ocrFallbackMultiWithLayout(file, pageCount)
  } else {
    const mod = await import("./ocrLocalFallback")
    return mod.ocrFallbackMultiWithLayout(file, pageCount)
  }
}

