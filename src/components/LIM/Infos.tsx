import React from "react"
import ClassicInfoPanel from "./ClassicInfoPanel"

type LIMData = {

  train?: string
  type?: string
  relation?: string
  rawDate?: string
  unit?: string
  material?: string
  line?: string
  lengthMeters?: number
  massTons?: number
  ouigoLogoUrl?: string
  // Enrichissements éventuels
  tren?: string
  origenDestino?: string
  fecha?: string
  composicion?: string
  linea?: string
  longitud?: string | number
  masa?: string | number
  operador?: string
  operadorLogo?: string
}

function buildPanelData(src: any): any {
  const d = src || {}
  // Accepte soit les clés déjà "espagnoles", soit les clés du LIMData
  const tren = String(d.tren ?? d.train ?? "").replace(/^0(?=\d)/, "")
  return {
    tren,
    type: d.type ?? "",
    origenDestino: d.origenDestino ?? d.relation ?? "",
    fecha: d.fecha ?? d.rawDate ?? "",
    composicion: d.composicion ?? d.unit ?? "",
    material: d.material ?? "",
    linea: d.linea ?? d.line ?? "",
    longitud: d.longitud ?? d.lengthMeters ?? "",
    masa: d.masa ?? d.massTons ?? "",
    operador: d.operador ?? "OUIGO",
    operadorLogo: d.operadorLogo ?? d.ouigoLogoUrl ?? "/ouigo.svg",
  }
}

export default function Infos() {
  const [raw, setRaw] = React.useState<LIMData>(() => {
    const w = window as any
    return (w.__limLastParsed || {}) as LIMData
  })

  // écoute du parseur LIM -> met à jour les infos brutes
  React.useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const payload = ce.detail || {}
      ;(window as any).__limLastParsed = payload
      setRaw(payload)
    }
    window.addEventListener('lim:parsed', onParsed as EventListener)
    return () => window.removeEventListener('lim:parsed', onParsed as EventListener)
  }, [])

  const panelData = buildPanelData(raw)

  // >>> AJOUT CRITIQUE <<< 
  // Dès qu'on connaît le numéro de train normalisé (panelData.tren),
  // on le diffuse en global pour FT.
  const lastDispatchedTrainRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const trenStr = panelData?.tren ?? ""
    if (!trenStr) return

    const n = parseInt(trenStr, 10)
    if (Number.isNaN(n)) {
      console.warn("[Infos] tren présent mais non numérique :", trenStr)
      return
    }

    // ✅ Dédupe locale (évite les doubles runs StrictMode / rerenders)
    if (lastDispatchedTrainRef.current === n) return
    lastDispatchedTrainRef.current = n

    // ✅ Dédupe globale (évite les redispatch si HMR/remount)
    const w = window as any
    if (w.__limLastTrainChangeDispatched === n) return
    w.__limLastTrainChangeDispatched = n

    window.dispatchEvent(
      new CustomEvent("lim:train-change", {
        detail: { trainNumber: n },
      })
    )
    console.log("[Infos] dispatch lim:train-change trainNumber=", n)
  }, [panelData?.tren])
  // <<< FIN AJOUT CRITIQUE <<<


  return (
    <section className="group/infos relative">
      <ClassicInfoPanel data={panelData} />
    </section>
  )
}

