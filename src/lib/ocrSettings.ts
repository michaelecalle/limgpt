// src/lib/ocrSettings.ts
const KEY = "lim:ocrOnline" as const

export function getOcrOnlineEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return true // ✅ défaut = ONLINE
    return raw === "1" || raw === "true"
  } catch {
    return true
  }
}

export function setOcrOnlineEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, enabled ? "1" : "0")
  } catch {}

  // utile pour la future UI
  try {
    window.dispatchEvent(
      new CustomEvent("lim:ocr-mode", { detail: { online: enabled } })
    )
  } catch {}
}
