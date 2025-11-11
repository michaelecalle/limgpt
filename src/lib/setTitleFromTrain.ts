// setTitleFromTrain.ts — met à jour document.title en "LIM <TREN>" (sans zéro initial) à chaque parse
type Fields = {
  tren?: string
  trenPadded?: string
}

(function setupSetTitle() {
  if ((window as any).__LIM_SET_TITLE_INSTALLED__) return
  ;(window as any).__LIM_SET_TITLE_INSTALLED__ = true

  const toTitleNumber = (s?: string): string | undefined => {
    if (!s) return undefined
    const digits = String(s).match(/\d+/)?.[0]
    if (!digits) return undefined
    // Supprimer les zéros initiaux pour l'affichage du titre uniquement
    const n = parseInt(digits, 10)
    if (!Number.isFinite(n)) return undefined
    return String(n)
  }

  const update = (f: Fields | undefined) => {
    if (!f) return
    // Priorité au padded pour la fiabilité, mais affichage sans zéros initiaux
    const raw = f.trenPadded ?? f.tren
    const display = toTitleNumber(raw)
    if (!display) return
    const wanted = `LIM ${display}`
    document.title = wanted
    // Debug discret
    try { console.debug("[LIM] Title set to:", wanted) } catch {}
  }

  window.addEventListener("lim:parsed", (e) => {
    const f = (e as CustomEvent).detail as Fields
    update(f)
  })
})()
