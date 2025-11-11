import React from "react"

type LIMFields = {
  tren?: string
  trenPadded?: string
  type?: string
  origenDestino?: string
  fecha?: string
  composicion?: string
  material?: string
  linea?: string
  longitud?: number | string
  masa?: number | string
  operador?: string
  operadorLogo?: string
  // Placeholders for future LTV metrics (we'll compute/fill them later)
  ltvA?: string | number | null
  ltvB?: string | number | null
  ltvNote?: string | null
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ")
}

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
    {children}
  </div>
)

const Tile: React.FC<{ className?: string; tone?: "muted" | "blue" | "yellow" } & React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  tone = "muted",
  ...rest
}) => {
  const base = "min-w-0 rounded-xl border border-zinc-300/80 bg-white/70 px-2 py-1.5 text-[13px] shadow-sm ring-1 ring-black/5 dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:ring-white/5"
  const toneCls =
    tone === "blue"
      ? "[background:linear-gradient(180deg,#01a5ce_0%,#7ed9ea_120%)]"
      : tone === "yellow"
      ? "[background:linear-gradient(180deg,#ffff00_0%,#fffda6_100%)]"
      : ""
  return <div className={cn(base, toneCls, className)} {...rest} />
}

const LTVPanel: React.FC = () => {
  const [data, setData] = React.useState<LIMFields | null>(null)

  React.useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const f = ce.detail as LIMFields
      setData(f)
    }
    window.addEventListener("lim:parsed", onParsed as EventListener)
    return () => window.removeEventListener("lim:parsed", onParsed as EventListener)
  }, [])

  const tren5 = data?.trenPadded ?? (data?.tren ? String(data?.tren).padStart(5, "0") : "—")
  const fecha = data?.fecha ? String(data.fecha) : "—"
  const compo = data?.composicion ?? "—"
  const rel = data?.origenDestino ?? "—"
  const tipo = data?.type ?? "—"
  const linea = (data?.linea ?? "—").toString().replace(/^L[ÍI]NEA(S)?\s*/i, "")
  const ltvA = data?.ltvA ?? "—"
  const ltvB = data?.ltvB ?? "—"
  const ltvNote = data?.ltvNote ?? ""

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="mb-2 text-base font-semibold tracking-tight">LTV</div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Tile tone="yellow">
          <Label>TREN</Label>
          <div className="font-medium text-zinc-900">{tren5}</div>
        </Tile>

        <Tile>
          <Label>TIPO</Label>
          <div className="font-medium text-zinc-900">{tipo}</div>
        </Tile>

        <Tile>
          <Label>COMPOSICIÓN</Label>
          <div className="font-medium text-zinc-900">{compo}</div>
        </Tile>

        <Tile className="sm:col-span-2 lg:col-span-3">
          <Label>ORIGEN / DESTINO</Label>
          <div className="truncate font-medium text-zinc-900">{rel}</div>
        </Tile>

        <Tile tone="yellow">
          <Label>FECHA</Label>
          <div className="font-medium text-zinc-900">{fecha}</div>
        </Tile>

        <Tile>
          <Label>LÍNEA(S)</Label>
          <div className="font-medium text-zinc-900">{linea}</div>
        </Tile>

        <Tile>
          <Label>MATERIAL</Label>
          <div className="font-medium text-zinc-900">{data?.material ?? "—"}</div>
        </Tile>

        {/* Placeholders pour les métriques LTV (à alimenter ensuite) */}
        <Tile tone="blue">
          <Label>LTV — A</Label>
          <div className="font-semibold">{ltvA}</div>
        </Tile>
        <Tile tone="blue">
          <Label>LTV — B</Label>
          <div className="font-semibold">{ltvB}</div>
        </Tile>
        <Tile className="lg:col-span-3">
          <Label>NOTE LTV</Label>
          <div className="font-medium">{ltvNote || "—"}</div>
        </Tile>
      </div>

      <style>{`
        .surface-header {
          background: linear-gradient(180deg, rgba(241,245,249,0.9) 0%, rgba(255,255,255,0.8) 100%);
        }
        html.dark .surface-header {
          background: linear-gradient(180deg, rgba(17,24,39,0.85) 0%, rgba(31,41,55,0.75) 100%);
        }
      `}</style>
    </section>
  )
}

export default LTVPanel
