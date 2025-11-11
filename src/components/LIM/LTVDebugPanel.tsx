import React from "react"

type DebugPayload = {
  textPdf?: string
  textOcr?: string | null
  source?: "pdfjs" | "vision"
  isSufficient?: boolean
  extractedRaw?: any
  extractedFromPdf?: any
  extractedFromOcr?: any
  timingMs?: {
    pdf?: number
    ocr?: number
    total?: number
  }
  pages?: number
}

const Box: React.FC<{ title: string; children?: React.ReactNode; mono?: boolean; dim?: boolean }> = ({ title, children, mono, dim }) => (
  <div className="rounded-xl border border-zinc-300/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/50 p-2 shadow-sm">
    <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-400 mb-1">{title}</div>
    <div className={`${mono ? "font-mono text-[11.5px] leading-5 whitespace-pre-wrap break-words" : "text-sm"} ${dim ? "opacity-80" : ""}`}>
      {children ?? <span className="opacity-60">—</span>}
    </div>
  </div>
)

const CopyBtn: React.FC<{ getText: () => string }> = ({ getText }) => {
  const [ok, setOk] = React.useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setOk(true)
      setTimeout(() => setOk(false), 1200)
    } catch {}
  }
  return (
    <button onClick={onCopy} className="btn btn-sm border rounded-lg px-2 py-1 text-xs">
      {ok ? "Copié ✓" : "Copier"}
    </button>
  )
}

// Safe stringify (évite les références circulaires et supprime les gros champs)
function safeStringify(obj: any): string {
  const seen = new WeakSet()
  const replacer = (_key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    if (_key === '__debug') return '[omitted __debug]'
    if (_key === 'textPdf' || _key === 'textOcr') return '[omitted long text]'
    return value
  }
  try { return JSON.stringify(obj, replacer, 2) } catch { return '[unstringifiable]' }
}

export default function LTVDebugPanel() {
  const [dbg, setDbg] = React.useState<DebugPayload | null>(null)
  // ⬇️ Par défaut: fermé (false). On ne l'ouvre que si l'utilisateur l'a explicitement laissé ouvert.
  const [open, setOpen] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ltv-debug-open") === "1" } catch { return false }
  })

  React.useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as any
      const { __debug, ...rest } = detail || {}
      const d = (__debug || {}) as DebugPayload
      d.extractedRaw = rest
      setDbg(d)
    }
    window.addEventListener("lim:parsed", onParsed as EventListener)
    return () => window.removeEventListener("lim:parsed", onParsed as EventListener)
  }, [])

  React.useEffect(() => {
    try { localStorage.setItem("ltv-debug-open", open ? "1" : "0") } catch {}
  }, [open])

  const summaryBadge = dbg ? (
    <span className={`badge ${dbg.isSufficient ? "ok" : "warn"} ml-2`}>
      {dbg.isSufficient ? "extraction ok" : "extraction incomplète"}
    </span>
  ) : null

  const sourceBadge = dbg?.source ? (
    <span className="badge ml-2">{dbg.source === "vision" ? "source: OCR Vision" : "source: PDF.js"}</span>
  ) : null

  return (
    <section className="card-glass p-2">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm font-semibold">
          Debug LTV {summaryBadge} {sourceBadge}
        </summary>

        {!dbg ? (
          <div className="mt-2 text-sm opacity-75">
            Importe un PDF pour voir les données de débogage.
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="flex items-center justify-between">
              <div className="text-xs opacity-70">
                Pages: {dbg.pages ?? "?"} · Temps total: {dbg.timingMs?.total ?? "?"} ms
                {typeof dbg.timingMs?.pdf === "number" ? ` · PDF: ${dbg.timingMs?.pdf} ms` : ""}
                {typeof dbg.timingMs?.ocr === "number" ? ` · OCR: ${dbg.timingMs?.ocr} ms` : ""}
              </div>
            </div>

            <div className="md:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium">Texte PDF.js</div>
                <CopyBtn getText={() => dbg.textPdf ?? ""} />
              </div>
              <Box title="" mono>
                {dbg.textPdf || "—"}
              </Box>
            </div>

            <div className="md:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium">Texte OCR (Vision)</div>
                <CopyBtn getText={() => dbg.textOcr ?? ""} />
              </div>
              <Box title="" mono dim>
                {dbg.textOcr ?? "n/a"}
              </Box>
            </div>

            <div className="md:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium">Champs extraits (PDF)</div>
                <CopyBtn getText={() => safeStringify(dbg.extractedFromPdf ?? {})} />
              </div>
              <Box title="" mono>
                <pre>{safeStringify(dbg.extractedFromPdf ?? {})}</pre>
              </Box>
            </div>

            <div className="md:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium">Champs extraits (OCR)</div>
                <CopyBtn getText={() => safeStringify(dbg.extractedFromOcr ?? {})} />
              </div>
              <Box title="" mono dim>
                <pre>{safeStringify(dbg.extractedFromOcr ?? {})}</pre>
              </Box>
            </div>

            <div className="md:col-span-full">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium">Champs finaux (merge)</div>
                <CopyBtn getText={() => safeStringify(dbg.extractedRaw ?? {})} />
              </div>
              <Box title="" mono>
                <pre>{safeStringify(dbg.extractedRaw ?? {})}</pre>
              </Box>
            </div>
          </div>
        )}
      </details>
    </section>
  )
}
