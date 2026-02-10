import React from "react"
import { getFtFranceHhmm } from "../../data/ftFranceTimes"

type Row = {
  sig?: string
  pk?: string
  vmax?: string
  loc?: string
  hhmm?: string
  panto?: string
  radio?: string
}

const baseRows: Row[] = [
  { pk: "748,9", vmax: "200", loc: "FIGUERES-VILAFANT" },
  { pk: "752,4", vmax: "SEP", loc: "LIMITE ADIF/LFP" },

  { sig: "ERTMS Niv. 1", pk: "25,6", loc: "TETE SUD TUNNEL" },
  { pk: "24,6", vmax: "300", loc: "FRONTIERE", panto: "25 kV" },
  { pk: "17,1", loc: "TETE NORD TUNNEL", radio: "GSM-R" },
  { pk: "12,9", loc: "SAUT DE MOUTON" },

  { sig: "SEP", pk: "1,2", vmax: "SEP", loc: "LIMITE LGV-RAC", panto: "SEP" },

  {
    sig: "BAL KVB",
    pk: "471,0",
    vmax: "160",
    loc: "LIMITE RAC LFP-FRR",
    panto: "1,5 kV",
  },
  { pk: "467,5", loc: "PERPIGNAN" },
]

// ✅ Largeurs "cibles" (référence), ajustées dynamiquement selon la largeur dispo
const COL_BASE = {
  sig: 140,
  pk: 90,
  vmax: 70,
  loc: 520,
  hhmm: 70,
  panto: 90,
  radio: 90,
}

// ✅ Largeurs minimales (pour éviter l’illisible en très petit)
const COL_MIN = {
  sig: 110,
  pk: 70,
  vmax: 55,
  loc: 200,
  hhmm: 55,
  panto: 70,
  radio: 70,
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
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
        " text-[14px] leading-tight font-semibold " +
        className
      }
      style={{
        minHeight: 22,
        verticalAlign: "middle",

        borderLeft: "2px solid var(--ft-border)",
        borderRight: "2px solid var(--ft-border)",
        borderBottom: "0px solid transparent",

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

function getDirectionFromTrainNumber(trainNumber?: number | null) {
  if (trainNumber == null) return null
  return trainNumber % 2 === 0 ? "FR_TO_ES" : "ES_TO_FR"
}

function isFigueresPk(pk?: string) {
  return pk === "748,9"
}

type FTFranceProps = {
  trainNumber?: number | null
  figueresDepartureHhmm?: string | null // ES->FR
  figueresArrivalHhmm?: string | null // FR->ES
}

export default function FTFrance({
  trainNumber,
  figueresDepartureHhmm = null,
  figueresArrivalHhmm = null,
}: FTFranceProps) {
  const direction = getDirectionFromTrainNumber(trainNumber)

  const figueresHhmm: string | null =
    direction === "ES_TO_FR"
      ? figueresDepartureHhmm
      : direction === "FR_TO_ES"
        ? figueresArrivalHhmm
        : null

  const getHhmmForRow = React.useCallback(
    (pk?: string) => {
      if (isFigueresPk(pk)) {
        const v = figueresHhmm ?? ""
        return v.trim() ? v : "—"
      }

      let lookupPk = pk
      if (direction === "FR_TO_ES") {
        if (pk === "471,0") lookupPk = "472,3"
        if (pk === "1,2") lookupPk = "0,8"
      }

      return getFtFranceHhmm(trainNumber ?? null, lookupPk)
    },
    [trainNumber, figueresHhmm, direction]
  )

  const rows = React.useMemo(() => {
    const dir = getDirectionFromTrainNumber(trainNumber)
    const base = baseRows

    const finalRows = dir === "FR_TO_ES" ? base.slice().reverse() : base.slice()

    const pkFixedRows =
      dir === "FR_TO_ES"
        ? finalRows.map((r) => {
            if (r.pk === "471,0") return { ...r, pk: "472,3" }
            if (r.pk === "1,2") return { ...r, pk: "0,8" }
            return r
          })
        : finalRows

    return pkFixedRows.map((r) => {
      const hhmmValue = getHhmmForRow(r.pk)
      if (!hhmmValue) return r
      return { ...r, hhmm: hhmmValue }
    })
  }, [trainNumber, getHhmmForRow])

  const [isNight, setIsNight] = React.useState<boolean>(() => detectNightFromDom())

  // ✅ Largeurs calculées selon la place réellement disponible
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const [colW, setColW] = React.useState(() => ({ ...COL_BASE }))

  React.useEffect(() => {
    const onTheme = (e: Event) => {
      const ce = e as CustomEvent
      const dark = !!ce?.detail?.dark
      setIsNight(dark)
    }

    window.addEventListener("lim:theme-change", onTheme as EventListener)

    const obsTheme = new MutationObserver(() => setIsNight(detectNightFromDom()))
    obsTheme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    obsTheme.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })

    return () => {
      window.removeEventListener("lim:theme-change", onTheme as EventListener)
      obsTheme.disconnect()
    }
  }, [])

  React.useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return

    const compute = () => {
      const w = el.clientWidth

      // on retire les 2px*nbColonnes de bordures + padding interne (approximatif)
      const usable = Math.max(0, w)

      const fixedBaseNoLoc =
        COL_BASE.sig +
        COL_BASE.pk +
        COL_BASE.vmax +
        COL_BASE.hhmm +
        COL_BASE.panto +
        COL_BASE.radio

      const minNoLoc =
        COL_MIN.sig +
        COL_MIN.pk +
        COL_MIN.vmax +
        COL_MIN.hhmm +
        COL_MIN.panto +
        COL_MIN.radio

      // Si on a moins que (mins + locMin), on force tout en min (ça restera lisible sans overflow)
      const minTotal = minNoLoc + COL_MIN.loc

      // échelle entre (base) et (min) selon la largeur disponible
      const targetTotalBase = fixedBaseNoLoc + COL_BASE.loc
      const targetTotalMin = minTotal

      let t = 1
      if (usable <= targetTotalMin) t = 0
      else if (usable >= targetTotalBase) t = 1
      else t = (usable - targetTotalMin) / (targetTotalBase - targetTotalMin)

      const lerp = (a: number, b: number, t01: number) => a + (b - a) * t01

      const sig = Math.round(lerp(COL_MIN.sig, COL_BASE.sig, t))
      const pk = Math.round(lerp(COL_MIN.pk, COL_BASE.pk, t))
      const vmax = Math.round(lerp(COL_MIN.vmax, COL_BASE.vmax, t))
      const hhmm = Math.round(lerp(COL_MIN.hhmm, COL_BASE.hhmm, t))
      const panto = Math.round(lerp(COL_MIN.panto, COL_BASE.panto, t))
      const radio = Math.round(lerp(COL_MIN.radio, COL_BASE.radio, t))

      const fixed = sig + pk + vmax + hhmm + panto + radio
      const loc = Math.max(COL_MIN.loc, usable - fixed)

      setColW({
        sig: clamp(sig, COL_MIN.sig, COL_BASE.sig),
        pk: clamp(pk, COL_MIN.pk, COL_BASE.pk),
        vmax: clamp(vmax, COL_MIN.vmax, COL_BASE.vmax),
        hhmm: clamp(hhmm, COL_MIN.hhmm, COL_BASE.hhmm),
        panto: clamp(panto, COL_MIN.panto, COL_BASE.panto),
        radio: clamp(radio, COL_MIN.radio, COL_BASE.radio),
        loc,
      })
    }

    compute()

    const ro = new ResizeObserver(() => compute())
    ro.observe(el)

    // double RAF: pliage/dépliage iOS / layout async
    const raf1 = window.requestAnimationFrame(() => {
      compute()
      window.requestAnimationFrame(compute)
    })

    return () => {
      window.cancelAnimationFrame(raf1)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="w-full h-full flex flex-col min-h-0"
      style={{
        ["--ft-border" as any]: isNight
          ? "rgba(255,255,255,0.85)"
          : "rgba(0,0,0,0.55)",
        ["--ft-header-border" as any]: isNight
          ? "rgba(255,255,255,0.85)"
          : "rgba(0,0,0,0.60)",
        ["--ft-border-w" as any]: "2px",

        ["--ft-cell-bg" as any]: isNight
          ? "rgba(0,0,0,0.98)"
          : "rgba(255,255,255,0.98)",
        ["--ft-text" as any]: isNight
          ? "rgba(255,255,255,0.92)"
          : "rgba(0,0,0,0.92)",
        ["--ft-sepbar" as any]: isNight
          ? "rgba(255,255,255,0.55)"
          : "rgba(82, 82, 91, 0.75)",
      }}
    >
      <style>{`
        .ftfr-body td:last-child { border-right: var(--ft-border-w) solid var(--ft-border); }
        .ftfr-body tbody td { border-top: 0 !important; border-bottom: 0 !important; }
        .ftfr-body tbody tr:first-child td { border-top: var(--ft-border-w) solid var(--ft-border) !important; }
        .ftfr-body tbody tr:last-child td  { border-bottom: var(--ft-border-w) solid var(--ft-border) !important; }
      `}</style>

      {/* ✅ IMPORTANT : hauteur = 100% dispo, scroll vertical si nécessaire, PAS de scroll horizontal */}
      <div className="w-full flex-1 min-h-0 overflow-auto">
        <table
          className="ftfr-body w-full table-fixed border-collapse"
          style={{ borderCollapse: "collapse" }}
        >
          <colgroup>
            <col style={{ width: colW.sig }} />
            <col style={{ width: colW.pk }} />
            <col style={{ width: colW.vmax }} />
            <col style={{ width: colW.loc }} />
            <col style={{ width: colW.hhmm }} />
            <col style={{ width: colW.panto }} />
            <col style={{ width: colW.radio }} />
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

                const isYellowRow =
                  !isSpacer && (r?.pk === "748,9" || r?.pk === "467,5")

                const bgPk = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgVmax = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgLoc = isYellowRow ? YELLOW_GRADIENT : undefined
                const bgHhmm = isYellowRow ? YELLOW_GRADIENT : undefined

                return (
                  <tr key={`${item.kind}-${item.origIdx}-${rIdx}`}>
                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="font-semibold">
                        {r.sig ?? ""}
                      </Td>
                    )}

                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="tabular-nums" bg={bgPk}>
                        {r.pk ?? ""}
                      </Td>
                    )}

                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="font-semibold" bg={bgVmax}>
                        {r.vmax ?? ""}
                      </Td>
                    )}

                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td
                        className="uppercase tracking-[0.02em] text-[13px]"
                        bg={bgLoc}
                      >
                        {r.loc ?? ""}
                      </Td>
                    )}

                    {isSpacer ? (
                      <SpacerTd />
                    ) : (
                      <Td align="center" className="tabular-nums" bg={bgHhmm}>
                        {r.hhmm === "—" ? (
                          <span className="opacity-50">—</span>
                        ) : (
                          r.hhmm ?? ""
                        )}
                      </Td>
                    )}

                    {isSpacer ? (
                      (() => {
                        const prev = rows[item.origIdx]
                        const next =
                          item.origIdx + 1 < rows.length
                            ? rows[item.origIdx + 1]
                            : null

                        const pkPrev = prev?.pk ?? ""
                        const pkNext = next?.pk ?? ""

                        const isBoundary471_12 =
                          (pkPrev === "471,0" && pkNext === "1,2") ||
                          (pkPrev === "1,2" && pkNext === "471,0")

                        const isBoundary4723_08 =
                          (pkPrev === "472,3" && pkNext === "0,8") ||
                          (pkPrev === "0,8" && pkNext === "472,3")

                        const isBoundary = isBoundary471_12 || isBoundary4723_08
                        return isBoundary ? <SepSpacerTd /> : <SpacerTd />
                      })()
                    ) : (
                      <Td align="center" className="font-semibold">
                        {isSepValue(r.panto) ? "" : r.panto ?? ""}
                      </Td>
                    )}

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
