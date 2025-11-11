// limDebugClient.ts — branche-le une seule fois (ex. dans main.tsx ou la page LIM)
// Active un log clair à chaque import PDF et à chaque "lim:parsed".
// Inclut un contrôle d'alignement ORIGEN/DESTINO attendu vs. calculé par règles de TREN.

type Fields = {
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

function inferRelationFromTrain(trenPadded?: string): string | undefined {
  if (!trenPadded || !/^\d{5}$/.test(trenPadded)) return undefined
  const first = trenPadded[0]
  const num = parseInt(trenPadded, 10)
  const odd = num % 2 === 1
  if (first === "0") return odd ? "Barcelona Sants - Limite ADIF-LFPSA" : "Limite ADIF-LFPSA - Barcelona Sants"
  if (first === "3") return odd ? "Can Tunis AV - Barcelona Sants" : "Barcelona Sants - Can Tunis AV"
  return undefined
}

(function setupLIMDebug() {
  if ((window as any).__LIM_DEBUG_INSTALLED__) return
  ;(window as any).__LIM_DEBUG_INSTALLED__ = true

  const cyan = "color:#06b6d4;font-weight:bold"
  const gray = "color:#6b7280"
  const yellow = "color:#b45309"
  const red = "color:#dc2626;font-weight:bold"
  const green = "color:#16a34a;font-weight:bold"

  window.addEventListener("lim:import-pdf", (e) => {
    const file = (e as CustomEvent).detail?.file as File | undefined
    const name = file?.name ?? "(fichier inconnu)"
    console.groupCollapsed("%c[LIM] Import PDF%c %s", cyan, "", name)
    console.log("%cFile:", gray, { name, size: file?.size })
    console.groupEnd()
  })

  window.addEventListener("lim:parsed", (e) => {
    const f = (e as CustomEvent).detail as Fields
    const exp = inferRelationFromTrain(f.trenPadded)
    const rel = f.origenDestino ?? f.relation

    const okTrain = !!(f.trenPadded && /^\d{5}$/.test(f.trenPadded))
    const okFecha = !!(f.fecha && String(f.fecha).trim().length > 0)
    const okCompo = !!(f.composicion && String(f.composicion).trim().length > 0)
    const okRel = !!(rel && String(rel).trim().length > 0)
    const okRelConsistent = exp ? exp === rel : true

    const allOk = okTrain && okFecha && okCompo && okRel && okRelConsistent

    console.groupCollapsed(
      "%c[LIM] Parsed%c tren=%s  %corigen=%s  %cfecha=%s  %ccomp=%s  %cOK=%s",
      cyan, "",
      f.trenPadded ?? f.tren ?? "—",
      yellow, rel ?? "—",
      gray, f.fecha ?? f.fechaRaw ?? "—",
      gray, f.composicion ?? "—",
      allOk ? green : red, allOk ? "YES" : "NO"
    )

    console.log("%cFields:", gray, f)
    if (exp && rel && exp !== rel) {
      console.warn("[LIM] ORIGEN attendu par règles =", exp, " / détecté =", rel)
    }
    if (!okFecha) console.warn("[LIM] FECHA manquante")
    if (!okCompo) console.warn("[LIM] COMPOSICIÓN manquante")
    if (!okTrain) console.warn("[LIM] TREN (5 chiffres) manquant ou invalide")

    console.groupEnd()
  })
})()
