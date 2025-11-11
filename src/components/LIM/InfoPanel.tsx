import React from "react"

export type InfoData = {
  tren?: string
  trenPadded?: string
  type?: string
  origenDestino?: string
  fecha?: string
  composicion?: string
  material?: string
  linea?: string
  longitud?: string | number
  masa?: string | number
  operador?: string
  operadorLogo?: string
}

const defaultData: InfoData = {
  tren: "09705",
  trenPadded: "09705",
  type: "T200",
  origenDestino: "Barcelona Sants - Limite ADIF-LFPSA",
  fecha: "",
  composicion: "UM",
  material: "TGV 2N2",
  linea: "Línea 050-066",
  longitud: 400,
  masa: 866,
  operador: "OUIGO",
  operadorLogo: "/ouigo.svg",
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-0 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
    {children}
  </div>
)

// -------- FECHA helpers (accept numeric and FR/ES textual long dates) --------
function parseFechaNumeric(fecha?: string) {
  if (!fecha) return null
  const m = fecha.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (!m) return null
  const d = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  const yRaw = parseInt(m[3], 10)
  const y = yRaw < 100 ? 2000 + yRaw : yRaw
  const dt = new Date(y, mo, d)
  return isNaN(dt.getTime()) ? null : dt
}

function parseFechaTextual(fecha?: string) {
  if (!fecha) return null
  const s = fecha
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[,\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  const months: Record<string, number> = {
    // fr
    "janvier":0,"fevrier":1,"février":1,"mars":2,"avril":3,"mai":4,"juin":5,"juillet":6,"aout":7,"août":7,"septembre":8,"octobre":9,"novembre":10,"decembre":11,"décembre":11,
    // es
    "enero":0,"febrero":1,"marzo":2,"abril":3,"mayo":4,"junio":5,"julio":6,"agosto":7,"septiembre":8,"setiembre":8,"octubre":9,"noviembre":10,"diciembre":11
  }

  // patterns: "mercredi 29 octobre 2025" | "miércoles 29 octubre 2025" | "29 octubre 2025"
  // (weekday optional)
  const re = /(?:(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})\s+([a-záéíóúñçâêîôûäëïöüèàùœ-]+)\s+(\d{4})/
  const m = s.match(re)
  if (m) {
    const day = parseInt(m[1], 10)
    const moName = m[2].toLowerCase()
    const year = parseInt(m[3], 10)
    const mi = months[moName]
    if (mi != null) {
      const dt = new Date(year, mi, day)
      return isNaN(dt.getTime()) ? null : dt
    }
  }
  return null
}

function parseFechaWide(fecha?: string) {
  return parseFechaNumeric(fecha) || parseFechaTextual(fecha) || null
}

function formatFechaLong(fecha?: string): string {
  if (!fecha) return "—"
  const dt = parseFechaWide(fecha)
  if (dt) {
    try {
      return dt.toLocaleDateString("fr-FR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "2-digit",
      }).toLowerCase()
    } catch { /* no-op */ }
  }
  // Si on ne peut pas parser (déjà normalisée par le parser), afficher telle quelle en minuscules
  return String(fecha).toLowerCase()
}

function isFechaToday(fecha?: string): boolean {
  const dt = parseFechaWide(fecha)
  if (!dt) return false
  const t = new Date()
  return dt.getFullYear() === t.getFullYear() && dt.getMonth() === t.getMonth() && dt.getDate() === t.getDate()
}

const HiddenMeasure: React.FC<{ text: string; onWidth: (w: number) => void; className?: string }> = ({ text, onWidth, className = "text-[13px] font-medium" }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => { if (ref.current) onWidth(ref.current.getBoundingClientRect().width) }, [text])
  return (
    <div className="invisible absolute -left-[9999px] top-0">
      <div ref={ref} className={className}>{text}</div>
    </div>
  )
}

const InfoPanel: React.FC<{ data?: InfoData }> = ({ data = defaultData }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null)

  const [wTrenText, setWTrenText] = React.useState<number>(0)
  const [wTypeText, setWTypeText] = React.useState<number>(0)

  React.useLayoutEffect(() => {
    const PAD = 18
    const SAFE_TREN = 10
    const SAFE_TYPE = 8
    if (hostRef.current) {
      hostRef.current.style.setProperty("--w-tren", Math.ceil(wTrenText + PAD + SAFE_TREN) + "px")
      hostRef.current.style.setProperty("--w-type", Math.ceil(wTypeText + PAD + SAFE_TYPE) + "px")
    }
  }, [wTrenText, wTypeText])

  // Always display a 5-digit train: prefer trenPadded, else pad tren
  const trainDisplay = data.trenPadded ?? (data.tren ? String(data.tren).padStart(5, "0") : "—")

  const longStr = data.longitud != null ? String(data.longitud).replace(/\s*m$/i, "") : "—"
  const masaStr = data.masa != null ? String(data.masa).replace(/\s*t$/i, "") : "—"
  const fechaLarga = formatFechaLong(data.fecha)
  const fechaIsToday = isFechaToday(data.fecha)
  const fechaIsValid = Boolean(data.fecha && String(data.fecha).trim().length > 0)
  const fechaShouldBlink = fechaIsValid && !fechaIsToday

  const tileBase =
    "min-w-0 rounded-xl border border-zinc-300/80 bg-white/70 px-2 py-1.25 text-[13px] shadow-sm ring-1 ring-black/5 dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:ring-white/5"
  const tileMuted = `${tileBase}`
  const tileAccentYellow = `${tileBase} [background:linear-gradient(180deg,#ffff00_0%,#fffda6_100%)]`
  const tileAccentBlue = `${tileBase} [background:linear-gradient(180deg,#01a5ce_0%,#7ed9ea_120%)]`

  return (
    <>
      <style>{`
        :root { --lim-gap: 0.35rem; --lim-gap-lg: 0.45rem; }
        @media (min-width: 640px) { :root { --lim-gap: 0.45rem; --lim-gap-lg: 0.55rem; } }

        @keyframes fechaPulse {
          0%, 55% { outline-color: rgba(255,213,0,0); outline-offset: 0px; box-shadow: 0 0 0 0 rgba(255,213,0,0); }
          62%    { outline-color: #ffd500; outline-offset: 2px; box-shadow: 0 0 0 3px rgba(255,213,0,0.55); }
          100%   { outline-color: rgba(255,213,0,0); outline-offset: 6px; box-shadow: 0 0 0 0 rgba(255,213,0,0); }
        }
        @keyframes fechaTextBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: .35; }
        }
        .blink-strong { animation: fechaPulse 2s ease-in-out infinite; }
        .blink-text { animation: fechaTextBlink 1s steps(2, end) infinite; will-change: opacity; }
        @media (prefers-reduced-motion: reduce) {
          .blink-strong, .blink-text { animation: none !important; }
        }

        html.dark .tile-light,
        body.dark .tile-light,
        [data-theme="night"] .tile-light,
        html.dark .tile-light *,
        body.dark .tile-light *,
        [data-theme="night"] .tile-light * {
          color: #111 !important;
        }
      `}</style>

      <section
        ref={hostRef}
        style={{ ["--w-tren" as any]: "6ch", ["--w-type" as any]: "5ch", ["--w-lastcol" as any]: "48ch" }}
        className="block w-full min-w-0 bg-transparent p-0 shadow-none ring-0 outline-none"
      >
        <HiddenMeasure text={trainDisplay ?? "00000"} onWidth={setWTrenText} />
        <HiddenMeasure text={data.type ?? "T000"} onWidth={setWTypeText} />

        {/* LIGNE 1 */}
        <div className="mb-[var(--lim-gap-lg)] flex items-stretch gap-[var(--lim-gap)]">
          {/* TREN */}
          <div style={{ width: "var(--w-tren)" }} className={tileAccentYellow}>
            <Label>TREN</Label>
            <div className="truncate font-medium text-zinc-900 leading-tight">{trainDisplay}</div>
          </div>

          {/* TYPE */}
          <div style={{ width: "var(--w-type)" }} className={`${tileMuted} flex items-center justify-center`}>
            <div className="truncate font-medium text-zinc-900 leading-tight">{data.type ?? "—"}</div>
          </div>

          {/* ORIGEN/DESTINO */}
          <div className={`${tileMuted} flex-1`} style={{ flexBasis: 0 }}>
            <Label>ORIGEN/DESTINO</Label>
            <div className="truncate font-medium text-zinc-900 leading-tight">{data.origenDestino ?? "—"}</div>
          </div>

          {/* FECHA (width locked) */}
          <div className="flex-none" style={{ width: "var(--w-lastcol)" }}>
            <div className={`${tileAccentYellow} ${fechaShouldBlink ? "blink-strong" : ""}`}>
              <Label>FECHA</Label>
              <div className={`truncate font-medium text-zinc-900 leading-tight ${fechaShouldBlink ? "blink-text" : ""}`}>{fechaLarga}</div>
            </div>
          </div>
        </div>

        {/* LIGNE 2 */}
        <div className="flex items-stretch gap-[var(--lim-gap)]">
          {/* LOGO */}
          <div style={{ width: "var(--w-tren)" }} className={`${tileAccentBlue} p-1 flex items-center justify-center`}>
            {data.operadorLogo ? (
              <img src={data.operadorLogo} alt="OUIGO" className="h-7 w-auto object-contain sm:h-8" />
            ) : (
              <div className="font-semibold text-white drop-shadow">OUIGO</div>
            )}
          </div>

          {/* COMPOSICIÓN */}
          <div style={{ width: "calc(11ch + 18px)" }} className={tileAccentYellow}>
            <Label>COMPOSICIÓN</Label>
            <div className="truncate font-medium text-zinc-900 leading-tight text-center">{data.composicion ?? "—"}</div>
          </div>

          {/* MATERIAL / LINEA(S) */}
          <div className={`${tileMuted} tile-light flex-1 text-black dark:text-black`} style={{ flexBasis: 0 }}>
            <div className="leading-tight">
              <div className="font-medium text-black dark:text-black">MATERIAL : {data.material ?? "—"}</div>
              <div className="font-medium text-black dark:text-black">{/((\d)\s*[-–]\s*(\d))/.test(String(data.linea ?? "")) ? "LINEAS" : "LINEA"} : {(data.linea ?? "").replace(/^L[ÍI]NEA(S)?\s*/i, "") || "—"}</div>
            </div>
          </div>

          {/* LONGITUD / MASA (width locked) */}
          <div className="flex-none" style={{ width: "var(--w-lastcol)" }}>
            <div className={tileMuted}>
              <Label>LONGITUD (m) - MASA (t)</Label>
              <div className="truncate font-medium text-zinc-900 leading-tight">{longitudAsText(longStr)} m - {masaStr} t</div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function longitudAsText(s: string) {
  return s
}

export default InfoPanel
