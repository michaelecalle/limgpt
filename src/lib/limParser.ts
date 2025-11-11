/* limParser.ts — v5.4.3 (FECHA + COMPOSICIÓN patch, title update)
   - Train: exactly 5 digits from PDF content (never filename), zeros kept.
   - Origen/Destino: detect canonical strings; fallback by train rules; sets `relation` & `origenDestino`.
   - FECHA: capture strictly the date token (numeric or textual), avoids swallowing following text.
   - COMPOSICIÓN: supports UM/US/DU/SOLO/SIMPLE/1UM/2UM, including patterns like "US 200m - 433t".
   - PDF page1 via pdf.js + OCR fallback; dispatches "lim:parsed"; updates document.title = "LIM <tren>".
*/
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { ocrFallback } from "./ocrFallback"
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

export type Fields = {
  tren?: string
  trenPadded?: string
  type?: string
  relation?: string
  origenDestino?: string
  fecha?: string
  fechaRaw?: string
  composicion?: string
  material?: string
  linea?: string
  longitud?: number | string
  masa?: number | string
  operador?: string
  operadorLogo?: string
  [k: string]: any
}

// -------------- helpers --------------
function cleanNumber(v?: string | number | null): number | undefined {
  if (v == null || v === "") return undefined
  const s = String(v).replace(/\s+/g, "").replace(",", ".")
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : undefined
}

function normalize(s: string): string {
  return s.replace(/\u00A0/g, " ").replace(/[\t]+/g, " ").replace(/\s{2,}/g, " ").trim()
}

function pickTrain(s: string): string | undefined {
  const up = s.toUpperCase()
  const re = /\b(\d{5})\b/g
  let m: RegExpExecArray | null
  let best: { num: string; idx: number; score: number } | null = null
  while ((m = re.exec(up))) {
    const idx = m.index
    const window = up.slice(Math.max(0, idx - 50), Math.min(up.length, idx + 50))
    const score = /(TREN|LIM)/.test(window) ? 0 : 1
    if (!best || score < best.score || (score === best.score && idx < best.idx)) {
      best = { num: m[1], idx, score }
    }
  }
  return best?.num
}

function detectRelation(txt: string, trenPadded?: string): string | undefined {
  const s = normalize(txt)

  // Canonical patterns (allow optional spaces around hyphens)
  const p1 = /Limite\s+ADIF\s*[-–]?\s*LFPSA\s*[-–]?\s*Barcelona\s+Sants/i
  const p2 = /Barcelona\s+Sants\s*[-–]?\s*Limite\s+ADIF\s*[-–]?\s*LFPSA/i
  const p3 = /Can\s+Tunis\s+AV\s*[-–]?\s*Barcelona\s+Sants/i
  const p4 = /Barcelona\s+Sants\s*[-–]?\s*Can\s+Tunis\s+AV/i
  if (p1.test(s)) return "Limite ADIF-LFPSA - Barcelona Sants"
  if (p2.test(s)) return "Barcelona Sants - Limite ADIF-LFPSA"
  if (p3.test(s)) return "Can Tunis AV - Barcelona Sants"
  if (p4.test(s)) return "Barcelona Sants - Can Tunis AV"

  // Fallback by train number rules
  if (trenPadded && /^\d{5}$/.test(trenPadded)) {
    const first = trenPadded[0]
    const num = parseInt(trenPadded, 10)
    const odd = num % 2 === 1
    if (first === "0") {
      return odd ? "Barcelona Sants - Limite ADIF-LFPSA" : "Limite ADIF-LFPSA - Barcelona Sants"
    }
    if (first === "3") {
      return odd ? "Can Tunis AV - Barcelona Sants" : "Barcelona Sants - Can Tunis AV"
    }
  }
  return undefined
}

// --------- FECHA extraction (return raw string; UI formats) ---------
function extractFechaRaw(s: string): string | undefined {
  const S = s

  // 1) "FECHA/DATE ... <date-token>"
  //    - capture strictly the first date token after the label
  const mLblNum = S.match(/\b(?:FECHA|DATE)\b[^\d\r\n]{0,20}([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{2}|\d{4}))/i)
  if (mLblNum) return mLblNum[1]

  const mLblTxt = S.match(/\b(?:FECHA|DATE)\b[^\dA-Za-z\u00C0-\u017F\r\n]{0,20}(\d{1,2}\s+[A-Za-z\u00C0-\u017F\-]+\s+\d{4})/i)
  if (mLblTxt) return mLblTxt[1]

  // 2) First numeric date near top 600 chars
  const head = S.slice(0, 600)
  const mNum = head.match(/\b([0-3]?\d)[\/.\-]([01]?\d)[\/.\-](\d{2}|\d{4})\b/)
  if (mNum) return `${mNum[1]}/${mNum[2]}/${mNum[3]}`

  // 3) First textual FR/ES date near top
  const mTxt = head.match(/\b(\d{1,2})\s+([A-Za-z\u00C0-\u017F\-]+)\s+(\d{4})\b/)
  if (mTxt) return `${mTxt[1]} ${mTxt[2]} ${mTxt[3]}`

  return undefined
}

// --------- COMPOSICIÓN extraction ---------
function extractComposicion(s: string): string | undefined {
  // A) Label-based
  const mLbl = s.match(/\b(?:COMPOSICI[ÓO]N|COMPOSICION)\b\s*[:\-–]?\s*([A-Z0-9]{1,4})\b/i)?.[1]
  if (mLbl) return mLbl.toUpperCase()

  // B) Pattern near longitud/masa: "<UNIT> 200m - 433t"
  const mLong = s.match(/\b(2UM|1UM|UM|US|DU|SOLO|SIMPLE)\b\s+\d{2,4}\s*m\b/i)?.[1]
  if (mLong) return mLong.toUpperCase()

  // C) Anywhere token
  const mAny = s.match(/\b(2UM|1UM|UM|US|DU|SOLO|SIMPLE)\b/i)?.[1]
  if (mAny) return mAny.toUpperCase()

  return undefined
}

// -------------- core text extraction --------------
export function extractFields(text: string): Fields {
  const s = normalize(text || "")

  // Train
  const trenPadded = pickTrain(s)
  const tren = trenPadded ?? undefined

  // Type
  const type =
    s.match(/\b(?:TYPE|TIPO(?:\s+(?:DE\s+TREN|TREN))?)\s*[:\-–]?\s*([A-Z]\d{2,3})\b/i)?.[1] ??
    s.match(/\bT\d{2,3}\b/)?.[0]

  // Relation (ORIGEN/DESTINO)
  const relation = detectRelation(s, trenPadded)

  // FECHA
  const fechaRaw = extractFechaRaw(s)
  const fecha = fechaRaw // UI will prettify

  // Material / Linea / longueur / masse
  const material = "TGV 2N2"
  const linea =
    s.match(/\b(?:LINEA|L[ÍI]NEA|LINEAS|L[ÍI]NEAS)\b\s*[:\-–]?\s*([0-9]{2,4}(?:\s*[-–]\s*[0-9]{2,4})?)/i)?.[1] ??
    undefined
  const lengthMeters = cleanNumber(s.match(/(\d{2,4})(?=\s*m\b)/i)?.[1] || s.match(/(\d{2,4})(?=m\b)/i)?.[1])
  const massTons = cleanNumber(s.match(/(\d{2,4})(?=\s*t\b)/i)?.[1] || s.match(/(\d{2,4})(?=t\b)/i)?.[1])

  const composicion = extractComposicion(s)

  const out: Fields = {
    tren,
    trenPadded,
    type,
    relation,
    origenDestino: relation,
    fecha,
    fechaRaw,
    composicion,
    material,
    linea,
    longitud: lengthMeters,
    masa: massTons,
    operador: "OUIGO",
    operadorLogo: "/ouigo.svg",
  }
  return out
}

// -------------- pdf.js + OCR pipeline --------------
async function readPdfFirstPage(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const loading = await (pdfjsLib as any).getDocument({ data: buf })
  const doc: PDFDocumentProxy = await loading.promise
  const page = await doc.getPage(1)
  const textContent = await page.getTextContent()
  const items = textContent.items as TextItem[]
  const text = items.map((it) => (it as any).str || "").join("\n")
  return text
}

function textLooksUsable(hay: string): boolean {
  const patterns = [/\bTREN\b/i, /\bCOMPOSIC/i, /\bFECHA\b/i, /\bLINEA/i, /\d{2,4}\s*m\b/i, /\d{2,4}\s*t\b/i]
  return patterns.some((re) => re.test(hay))
}

function mergePreferA(a: any, b: any) {
  const out: any = { ...a }
  for (const k of Object.keys(b)) {
    const vA = a[k], vB = b[k]
    if (vA == null || vA === "" || (typeof vA === "number" && !Number.isFinite(vA))) {
      if (vB != null && vB !== "") out[k] = vB
    }
  }
  return out
}

export async function handleFile(file: File): Promise<Fields> {
  const textA = await readPdfFirstPage(file)
  const fieldsA = extractFields(textA || "")

  const needsOCR = !textLooksUsable(textA || "") ||
    (!fieldsA.type || !fieldsA.fecha || !fieldsA.composicion || !fieldsA.longitud || !fieldsA.trenPadded || !fieldsA.origenDestino)

  let fields = fieldsA
  if (needsOCR) {
    const textB = await ocrFallback(file)
    const fieldsB = extractFields(textB || "")
    fields = mergePreferA(fieldsA, fieldsB)
  }

  window.dispatchEvent(new CustomEvent("lim:parsed", { detail: fields }))

  // Set browser title "LIM <number>" if available
  try {
    const t = fields.trenPadded ?? fields.tren
    if (t && typeof document !== "undefined") {
      if (!/^\s*LIM\b/.test(document.title)) {
        document.title = `LIM ${t}`
      } else {
        document.title = document.title.replace(/^LIM\s+\S+/, `LIM ${t}`)
      }
    }
  } catch {}

  return fields
}

function setup() {
  const onImport = (e: Event) => {
    const ce = e as CustomEvent
    const file: File | undefined = ce.detail?.file
    if (file) void handleFile(file)
  }
  window.addEventListener("lim:import-pdf", onImport as EventListener)
}
setup()
