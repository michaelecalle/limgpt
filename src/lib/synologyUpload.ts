// src/lib/synologyUpload.ts
//
// Upload PDF vers Synology DSM (File Station WebAPI) via QuickConnect.
// DSM: 7.x
//
// ⚠️ Important : depuis une app React (navigateur), tu peux être bloqué par CORS.
// Si tu vois une erreur du type “CORS policy / blocked by CORS”, on devra soit
// - passer par un petit proxy (recommandé),
// - soit configurer un reverse-proxy DSM qui ajoute les headers CORS.
//
// Pour l’instant on met la brique “client WebAPI” proprement.

export type SynologyUploadConfig = {
  // Exemple: "https://michaelecalle.quickconnect.to"
  // (ou une URL reverse-proxy à toi)
  baseUrl: string

  // Compte DSM dédié (ex: limgpt_uploader)
  username: string
  password: string

  // Dossier cible DSM (ex: "/LIMGPT_REPLAY/pdfs")
  // ⚠️ Chemin FileStation => commence par "/"
  destDir: string
}

export type SynologyUploadResult = {
  ok: boolean
  pdfId: string
  remotePath?: string // ex: "/LIMGPT_REPLAY/pdfs/<pdfId>.pdf"
  error?: string
  debug?: any
}

// --- helpers ---------------------------------------------------------

const ENTRY = "/webapi/entry.cgi"

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + path
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return text
}

// --- Auth ------------------------------------------------------------

// Login WebAPI -> sid
async function synoLogin(cfg: SynologyUploadConfig): Promise<string> {
  const url = new URL(joinUrl(cfg.baseUrl, ENTRY))
  url.searchParams.set("api", "SYNO.API.Auth")
  url.searchParams.set("version", "6")
  url.searchParams.set("method", "login")
  url.searchParams.set("account", cfg.username)
  url.searchParams.set("passwd", cfg.password)
  url.searchParams.set("session", "FileStation")
  url.searchParams.set("format", "sid")

  const text = await fetchText(url.toString(), {
    method: "GET",
    credentials: "include",
  })
  const json = safeJsonParse(text)
  if (!json?.success || !json?.data?.sid) {
    throw new Error(`Login échoué: ${text}`)
  }
  return String(json.data.sid)
}

async function synoLogout(cfg: SynologyUploadConfig, sid: string): Promise<void> {
  const url = new URL(joinUrl(cfg.baseUrl, ENTRY))
  url.searchParams.set("api", "SYNO.API.Auth")
  url.searchParams.set("version", "6")
  url.searchParams.set("method", "logout")
  url.searchParams.set("session", "FileStation")
  url.searchParams.set("_sid", sid)

  // Si ça échoue, ce n’est pas bloquant.
  try {
    await fetchText(url.toString(), { method: "GET", credentials: "include" })
  } catch {}
}

// --- Upload ----------------------------------------------------------

/**
 * Upload un PDF sous le nom "<pdfId>.pdf" dans cfg.destDir.
 * Retourne remotePath (chemin DSM) si ok.
 */
export async function uploadPdfToSynology(
  cfg: SynologyUploadConfig,
  file: File,
  pdfId: string
): Promise<SynologyUploadResult> {
  try {
    // OVH endpoint (mutualisé)
    const endpoint = "https://radioequinoxe.com/limgpt/upload_pdf.php"

    // Token côté serveur (upload_pdf.php)
    const token = "limgpt_upload_v1_9f3a7c2e"

    // Multipart attendu par le PHP : file + pdfId (+ token)
    const form = new FormData()
    form.append("token", token)
    form.append("pdfId", pdfId)
    form.append("file", file, `${pdfId}.pdf`)

    const res = await fetch(endpoint, { method: "POST", body: form })
    const text = await res.text()

    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }

    // Succès attendu: { ok:true, pdfId, remoteUrl }
    if (res.ok && json?.ok && typeof json?.remoteUrl === "string") {
      return {
        ok: true,
        pdfId,
        // On réutilise "remotePath" comme "remoteUrl" pour ne rien changer ailleurs
        remotePath: json.remoteUrl,
        debug: json,
      }
    }

    return {
      ok: false,
      pdfId,
      error: `Upload OVH échoué: ${text}`,
      debug: json ?? text,
    }
  } catch (err: any) {
    return {
      ok: false,
      pdfId,
      error: err?.message ? String(err.message) : String(err),
    }
  }
}

/**
 * Upload un LOG (NDJSON déguisé en .pdf) sous le nom "<logId>.pdf" dans /replay/logs/.
 * Retourne remotePath (URL) si ok.
 *
 * Note: on garde SynologyUploadResult/pdfId pour ne pas impacter les types existants.
 */
export async function uploadLogToOvh(
  file: File,
  logId: string
): Promise<SynologyUploadResult> {
  try {
    const endpoint = "https://radioequinoxe.com/limgpt/upload_log.php"
    const token = "limgpt_upload_v1_9f3a7c2e"

    const form = new FormData()
    form.append("token", token)
    form.append("logId", logId)
    form.append("file", file, `${logId}.txt`)

    const res = await fetch(endpoint, { method: "POST", body: form })
    const text = await res.text()

    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }

    // Succès attendu: { ok:true, logId, remoteUrl }
    if (res.ok && json?.ok && typeof json?.remoteUrl === "string") {
      return {
        ok: true,
        pdfId: logId,
        remotePath: json.remoteUrl,
        debug: json,
      }
    }

    return {
      ok: false,
      pdfId: logId,
      error: `Upload log OVH échoué: ${text}`,
      debug: json ?? text,
    }
  } catch (err: any) {
    return {
      ok: false,
      pdfId: logId,
      error: err?.message ? String(err.message) : String(err),
    }
  }
}



