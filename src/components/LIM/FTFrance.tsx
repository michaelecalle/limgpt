import React from "react"

type Row = {
  sig?: string
  pk?: string
  vmax?: string
  loc?: string
  hhmm?: string
  panto?: string
  radio?: string
}

const COL_W = {
  sig: 140,
  pk: 90,
  vmax: 70,
  loc: 520,
  hhmm: 70,
  panto: 90,
  radio: 90,
}

function isSepValue(v: unknown) {
  return typeof v === "string" && v.trim().toUpperCase() === "SEP"
}

// ✅ Dégradé EXACT comme ClassicInfoPanel
const YELLOW_GRADIENT = "linear-gradient(180deg,#ffff00 0%,#fffda6 100%)"

function SepBar() {
  return (
    <div className="w-full h-full flex items-center">
      <div
        style={{
          height: 4,
          width: "100%",
          borderRadius: 999,
          backgroundColor: "var(--ft-sepbar)",
        }}
      />
    </div>
  )
}

function Td({
  children,
  className = "",
  align = "left",
  bg,
}: {
  children?: React.ReactNode
  className?: string
  align?: "left" | "center" | "right"
  bg?: string
}) {
  const isSep = isSepValue(children)

  // ✅ alignement horizontal via flex
  const justify =
    align === "center"
      ? "justify-center"
      : align === "right"
      ? "justify-end"
      : "justify-start"

  return (
    <td
      className={
        (isSep ? "px-0 py-2" : "px-2 py-2") +
        " text-[12px] leading-tight " +
        className
      }
      style={{
        minHeight: 22,
        verticalAlign: "middle",

        borderLeft: "2px solid var(--ft-border)",
        borderRight: "2px solid var(--ft-border)",
        borderBottom: "0px solid transparent",

        // ✅ si bg est défini => on met le gradient, sinon fond selon mode
        backgroundImage: bg ? bg : undefined,
        backgroundColor: bg ? undefined : "var(--ft-cell-bg)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100%",

        color: "var(--ft-text)",
      }}
    >
      <div className={`w-full h-full flex items-center ${justify}`}>
        {isSep ? <SepBar /> : children}
      </div>
    </td>
  )
}

function SpacerTd({ colSpan }: { colSpan?: number }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        height: 20,
        padding: 0,
        backgroundColor: "var(--ft-cell-bg)",
        borderLeft: "2px solid var(--ft-border)",
        borderRight: "2px solid var(--ft-border)",
        borderTop: "2px solid var(--ft-border)",
        borderBottom: "2px solid var(--ft-border)",
      }}
    />
  )
}

function SepSpacerTd() {
  return (
    <td
      style={{
        height: 20,
        padding: 0,
        backgroundColor: "var(--ft-cell-bg)",
        borderLeft: "2px solid var(--ft-border)",
        borderRight: "2px solid var(--ft-border)",
        borderTop: "2px solid var(--ft-border)",
        borderBottom: "2px solid var(--ft-border)",
      }}
    >
      <SepBar />
    </td>
  )
}

function detectNightFromDom(): boolean {
  if (typeof document === "undefined") return false
  const de = document.documentElement
  const bd = document.body

  const hasDarkClass =
    de.classList.contains("dark") || bd.classList.contains("dark")

  const themeAttr =
    de.getAttribute("data-theme") || bd.getAttribute("data-theme") || ""

  const isNightAttr =
    themeAttr === "night" || themeAttr === "dark" || themeAttr === "nuit"

  return hasDarkClass || isNightAttr
}

export default function FTFrance() {
  const rows: Row[] = [
    { pk: "748,9", vmax: "200", loc: "FIGUERES-VILAFANT" },
    { pk: "752,4", vmax: "SEP", loc: "LIMITE ADIF/LFP" },

    { sig: "ERTMS Niv. 1", pk: "25,6", loc: "TETE SUD TUNNEL" },
    { pk: "24,6", vmax: "300", loc: "FRONTIERE", panto: "25 kV" },
    { pk: "17,1", loc: "TETE NORD TUNNEL", radio: "GSM-R" },
    { pk: "12,9", loc: "SAUT DE MOUTON" },

    { sig: "SEP", pk: "1,2", vmax: "SEP", loc: "LIMITE LGV-RAC", panto: "SEP" },

    { sig: "BAL KVB", pk: "471,0", vmax: "160", loc: "LIMITE RAC LFP-FRR", panto: "1,5 kV" },
    { pk: "467,5", loc: "PERPIGNAN" },
  ]

  // ✅ état nuit piloté par l’app (event), avec fallback DOM
  const [isNight, setIsNight] = React.useState<boolean>(() => detectNightFromDom())

  React.useEffect(() => {
    const onTheme = (e: Event) => {
      const ce = e as CustomEvent
      const dark = !!ce?.detail?.dark
      setIsNight(dark)
    }

    window.addEventListener("lim:theme-change", onTheme as EventListener)

    // fallback : si le thème change via classe/attr sans event
    const obs = new MutationObserver(() => setIsNight(detectNightFromDom()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] })
    obs.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] })

    return () => {
      window.removeEventListener("lim:theme-change", onTheme as EventListener)
      obs.disconnect()
    }
  }, [])

  return (
    <div
      className="flex flex-col"
      style={{
        // ✅ variables couleurs table
        ["--ft-border" as any]: isNight ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.55)",
        ["--ft-header-border" as any]: isNight ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.60)",
        ["--ft-border-w" as any]: "2px",

        ["--ft-cell-bg" as any]: isNight ? "rgba(0,0,0,0.98)" : "rgba(255,255,255,0.98)",
        ["--ft-text" as any]: isNight ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.92)",
        ["--ft-sepbar" as any]: isNight ? "rgba(255,255,255,0.55)" : "rgba(82, 82, 91, 0.75)",
      }}
    >
      <style>{`
        .ftfr-body td:last-child { border-right: var(--ft-border-w) solid var(--ft-border); }

        .ftfr-body tbody td { border-top: 0 !important; border-bottom: 0 !important; }

        .ftfr-body tbody tr:first-child td { border-top: var(--ft-border-w) solid var(--ft-border) !important; }
        .ftfr-body tbody tr:last-child td  { border-bottom: var(--ft-border-w) solid var(--ft-border) !important; }
      `}</style>

      <div className="w-full">
        <table
          className="ftfr-body w-full table-fixed border-collapse"
          style={{ borderCollapse: "collapse" }}
        >
          <colgroup>
            <col style={{ width: COL_W.sig }} />
            <col style={{ width: COL_W.pk }} />
            <col style={{ width: COL_W.vmax }} />
            <col />
            <col style={{ width: COL_W.hhmm }} />
            <col style={{ width: COL_W.panto }} />
            <col style={{ width: COL_W.radio }} />
          </colgroup>

          <thead>
            <tr>
              <th
                className="px-2 py-1 text-left text-white text-[12px] font-semibold"
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                  background: "#1f5fe0",
                  borderBottom: "var(--ft-border-w) solid var(--ft-header-border)",
                }}
              >
                Sen/Sig
              </th>

              {[
                { label: "PK", align: "left" as const },
                { label: "Vmax", align: "left" as const },
                { label: "Localizacion/Localisation", align: "left" as const },
                { label: "hh:mm", align: "center" as const },
                { label: "Panto", align: "center" as const },
                { label: "Radio", align: "center" as const },
              ].map((c, idx) => (
                <th
                  key={idx}
                  className={
                    "px-2 py-1 text-white text-[12px] font-semibold " +
                    (c.align === "center" ? "text-center" : "text-left")
                  }
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 5,
                    background: "#1f5fe0",
                    borderLeft: "var(--ft-border-w) solid var(--ft-header-border)",
                    borderBottom: "var(--ft-border-w) solid var(--ft-header-border)",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {(() => {
              const displayRows: Array<
                | { kind: "data"; row: Row; origIdx: number }
                | { kind: "spacer"; origIdx: number }
              > = []

              rows.forEach((r, origIdx) => {
                displayRows.push({ kind: "data", row: r, origIdx })
                if (origIdx < rows.length - 1) {
                  displayRows.push({ kind: "spacer", origIdx })
                }
              })

              displayRows.push({ kind: "spacer", origIdx: rows.length - 1 })

              return displayRows.map((item, rIdx) => {
                const isSpacer = item.kind === "spacer"
                const r = item.kind === "data" ? item.row : (null as any)

                // ✅ surlignage uniquement sur les lignes data 748,9 et 467,5
                const isYellowRow =
                  !isSpacer && (r?.pk === "748,9" || r?.pk === "467,5")

                // ✅ colonnes ciblées : PK, Vmax, Loc, hh:mm
                const bgPk = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgVmax = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgLoc = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgHhmm = isYellowRow ? YELLOW_GRADIENT : undefined

                return (
                  <tr key={`${item.kind}-${item.origIdx}-${rIdx}`}>
                    {/* Sen/Sig (PAS surligné) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="font-semibold">
                        {r.sig ?? ""}
                      </Td>
                    )}

                    {/* PK (surligné si ligne cible) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="tabular-nums" bg={bgPk}>
                        {r.pk ?? ""}
                      </Td>
                    )}

                    {/* Vmax (surligné si ligne cible) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="font-semibold" bg={bgVmax}>
                        {r.vmax ?? ""}
                      </Td>
                    )}

                    {/* Localisation (surligné si ligne cible) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td
                        className="uppercase tracking-[0.02em] text-[11px]"
                        bg={bgLoc}
                      >
                        {r.loc ?? ""}
                      </Td>
                    )}

                    {/* hh:mm (surligné si ligne cible) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="tabular-nums" bg={bgHhmm}>
                        {r.hhmm ?? ""}
                      </Td>
                    )}

                    {/* Panto (PAS surligné) */}
                    {isSpacer ? (
                      isSepValue(rows[item.origIdx]?.panto) ? (
                        <SepSpacerTd />
                      ) : (
                        <SpacerTd />
                      )
                    ) : (
                      <Td align="center" className="font-semibold">
                        {isSepValue(r.panto) ? "" : r.panto ?? ""}
                      </Td>
                    )}

                    {/* Radio (PAS surligné) */}
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="font-semibold">
                        {r.radio ?? ""}
                      </Td>
                    )}
                  </tr>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
