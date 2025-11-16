import React, { useEffect, useState, useRef } from "react"

/**
 * LTV — Tableau principal + module de recadrage NEEDS_CROP
 *
 * Fonctionnalités :
 * - Affichage texte direct (DISPLAY_DIRECT) à partir de rows[]
 * - Recadrage manuel quand mode NEEDS_CROP
 * - Zoom temporaire + auto-pan pendant drag
 * - Réinitialiser
 * - Validation du recadrage → image finale insérée visuellement dans le tableau
 * - Clic sur l'image finale → retour en édition
 * - Mode sombre : inversion de l'image finale
 * - En-têtes verticaux compatibles iPad
 * - Largeurs de colonnes alignées
 */

type LTVMode = "DISPLAY_DIRECT" | "NEEDS_CROP" | "NO_LTV"

/**
 * Une ligne LTV prête à être affichée (vient du parseur principal,
 * hérite de la logique du Standalone Tester).
 */
type LtvRow = {
  code: string
  section: string
  via: string
  kmIni: string
  kmFin: string
  speed: string
  motivo: string
  fecha1: string
  hora1: string
  fecha2: string
  hora2: string
  viaCheck: boolean
  sistema: boolean
  soloCabeza: boolean
  csv: boolean
  observaciones: string
}

type LTVEventDetail = {
  mode?: LTVMode
  previewImageDataUrl?: string
  altPreviewImageDataUrl?: string
  rows?: LtvRow[]
}

const LTV: React.FC = () => {
  // --- état venant du parseur LTV (ltvParser.ts)
  const [ltvMode, setLtvMode] = useState<LTVMode | "">("")

  // Deux candidates envoyées par le parseur en mode DISPLAY_DIRECT
  const [previewImage, setPreviewImage] = useState<string | undefined>(
    undefined
  )
  const [altPreviewImage, setAltPreviewImage] = useState<string | undefined>(
    undefined
  )

  // Quelle candidate est sélectionnée actuellement pour DISPLAY_DIRECT
  // "main" = previewImageDataUrl, "alt" = altPreviewImageDataUrl
  const [selectedImage, setSelectedImage] = useState<"main" | "alt">("main")

  // Une fois validé par l'utilisateur → plus de bascule possible
  const [lockedDisplayDirect, setLockedDisplayDirect] =
    useState<boolean>(false)

  // lignes LTV structurées pour DISPLAY_DIRECT
  const [rows, setRows] = useState<LtvRow[]>([])

  // --- refs
  const previewImgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // true = on édite encore (bandes rouges visibles)
  // false = recadrage validé, on montre juste le résultat final propre
  const [isCropping, setIsCropping] = useState<boolean>(true)

  // dataURL PNG finale après validation
  // Sert pour :
  //  - le résultat du recadrage manuel (NEEDS_CROP)
  //  - l'image choisie en DISPLAY_DIRECT (sans recadrage)
  const [finalCroppedUrl, setFinalCroppedUrl] = useState<string | null>(null)

  // Cadre de recadrage en pourcentages (par rapport à l'image affichée)
  const [cropBox, setCropBox] = useState({
    top: 20,
    bottom: 80,
    left: 10,
    right: 90,
  })

  // quelle barre rouge est en train d'être déplacée
  const [draggingEdge, setDraggingEdge] = useState<
    null | "top" | "bottom" | "left" | "right"
  >(null)

  // zoom visuel pendant l'édition
  const [zoom, setZoom] = useState(1)

  // translation (pan) pendant le zoom
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)

  // point d'ancrage du début du drag (en px écran)
  const [anchorX, setAnchorX] = useState<number | null>(null)
  const [anchorY, setAnchorY] = useState<number | null>(null)

  // Quand le parseur envoie un nouveau PDF : reset / chargement
  useEffect(() => {
    const onLtvParsed = (e: Event) => {
      const ce = e as CustomEvent<LTVEventDetail>

      // log debug pour analyse
      console.log("[LTV] ltv:parsed RAW detail =", ce.detail)

      const mode = ce.detail?.mode
      // champs possibles venant du parseur
      const imgMain = (ce.detail as any)?.previewImageDataUrl
      const imgAlt = (ce.detail as any)?.altPreviewImageDataUrl
      const incomingRows = ce.detail?.rows ?? []

      console.log("[LTV] ltv:parsed reçu =", {
        mode,
        imgMainLen: imgMain?.length,
        imgAltLen: imgAlt?.length,
        rows: incomingRows,
      })

      if (mode) setLtvMode(mode)
      setRows(incomingRows)

      // --- DISPLAY_DIRECT : images candidates directement exploitables ---
      if (mode === "DISPLAY_DIRECT" && imgMain) {
        console.log("[LTV] init DISPLAY_DIRECT")

        setPreviewImage(imgMain || undefined)
        setAltPreviewImage(imgAlt || undefined)

        // par défaut on affiche la principale
        setSelectedImage("main")
        setFinalCroppedUrl(imgMain || null)

        // tant que l'utilisateur n'a pas validé manuellement :
        setLockedDisplayDirect(false)

        // pas de recadrage manuel dans ce mode
        setIsCropping(false)

        // reset visu
        setZoom(1)
        setPanX(0)
        setPanY(0)
        setDraggingEdge(null)
        setAnchorX(null)
        setAnchorY(null)
        setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
        return
      }

      // --- NEEDS_CROP : recadrage manuel ---
      if (mode === "NEEDS_CROP") {
        console.log("[LTV] init NEEDS_CROP")

        // même si imgMain est vide par erreur, on force le mode
        // pour pouvoir afficher un fallback clair
        setPreviewImage(imgMain || undefined)
        setAltPreviewImage(undefined)
        setSelectedImage("main")
        setLockedDisplayDirect(false)

        setIsCropping(true)
        setFinalCroppedUrl(null)

        setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
        setZoom(1)
        setPanX(0)
        setPanY(0)
        setDraggingEdge(null)
        setAnchorX(null)
        setAnchorY(null)
        return
      }

      // --- NO_LTV / fallback ---
      console.log("[LTV] init NO_LTV / fallback")

      setPreviewImage(undefined)
      setAltPreviewImage(undefined)
      setSelectedImage("main")
      setLockedDisplayDirect(false)

      setIsCropping(true)
      setFinalCroppedUrl(null)
      setZoom(1)
      setPanX(0)
      setPanY(0)
      setDraggingEdge(null)
      setAnchorX(null)
      setAnchorY(null)
      setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
    }

    window.addEventListener("ltv:parsed", onLtvParsed as EventListener)
    return () => {
      window.removeEventListener("ltv:parsed", onLtvParsed as EventListener)
    }
  }, [])

  // --- début du drag (NEEDS_CROP)
  const handleEdgeStart = (
    edge: "top" | "bottom" | "left" | "right",
    clientX: number,
    clientY: number
  ) => {
    if (!previewImgRef.current || !containerRef.current) {
      setDraggingEdge(edge)
      setZoom(2.5)
      return
    }

    setDraggingEdge(edge)

    // mémorise le point saisi
    setAnchorX(clientX)
    setAnchorY(clientY)

    // centre le zoom autour du point saisi
    const viewportRect =
      containerRef.current.parentElement?.getBoundingClientRect()

    if (viewportRect) {
      const scaleTarget = 2.5

      const viewportCenterX = viewportRect.left + viewportRect.width / 2
      const viewportCenterY = viewportRect.top + viewportRect.height / 2

      const dx = clientX - viewportCenterX
      const dy = clientY - viewportCenterY

      const extraX = dx * (scaleTarget - 1)
      const extraY = dy * (scaleTarget - 1)

      setPanX((oldX) => oldX - extraX)
      setPanY((oldY) => oldY - extraY)

      setZoom(scaleTarget)
    } else {
      setZoom(2.5)
    }
  }

  // --- déplacement en cours (NEEDS_CROP)
  const handleEdgeMove = (clientX: number, clientY: number) => {
    if (!draggingEdge || !previewImgRef.current || !containerRef.current) return

    const rect = previewImgRef.current.getBoundingClientRect()
    const relXpct = ((clientX - rect.left) / rect.width) * 100
    const relYpct = ((clientY - rect.top) / rect.height) * 100

    // mettre à jour la position du cadre
    setCropBox((prev) => {
      const next = { ...prev }

      if (draggingEdge === "top") {
        next.top = Math.max(0, Math.min(relYpct, prev.bottom - 5))
      }
      if (draggingEdge === "bottom") {
        next.bottom = Math.min(100, Math.max(relYpct, prev.top + 5))
      }
      if (draggingEdge === "left") {
        next.left = Math.max(0, Math.min(relXpct, prev.right - 5))
      }
      if (draggingEdge === "right") {
        next.right = Math.min(100, Math.max(relXpct, prev.left + 5))
      }

      return next
    })

    // auto-pan si on approche du bord visible (viewport)
    const viewportEl = containerRef.current.parentElement
    if (!viewportEl) return

    const viewportRect = viewportEl.getBoundingClientRect()

    const marginPx = 80
    const step = 5

    // haut / bas
    if (clientY - viewportRect.top < marginPx) {
      setPanY((y) => y + step)
    } else if (viewportRect.bottom - clientY < marginPx) {
      setPanY((y) => y - step)
    }

    // gauche / droite
    if (clientX - viewportRect.left < marginPx) {
      setPanX((x) => x + step)
    } else if (viewportRect.right - clientX < marginPx) {
      setPanX((x) => x - step)
    }
  }

  // --- fin du drag (NEEDS_CROP)
  const handleEdgeEnd = () => {
    setDraggingEdge(null)

    // retour vue repos
    setZoom(1)
    setPanX(0)
    setPanY(0)

    setAnchorX(null)
    setAnchorY(null)
  }

  // listeners globaux pour le drag
  useEffect(() => {
    const onMoveMouse = (e: MouseEvent) => {
      if (!draggingEdge) return
      handleEdgeMove(e.clientX, e.clientY)
    }
    const onMoveTouch = (e: TouchEvent) => {
      if (!draggingEdge) return
      const t = e.touches[0]
      handleEdgeMove(t.clientX, t.clientY)
    }
    const onUp = () => {
      if (draggingEdge) {
        handleEdgeEnd()
      }
    }

    window.addEventListener("mousemove", onMoveMouse)
    window.addEventListener("touchmove", onMoveTouch, { passive: false })
    window.addEventListener("mouseup", onUp)
    window.addEventListener("touchend", onUp)

    return () => {
      window.removeEventListener("mousemove", onMoveMouse)
      window.removeEventListener("touchmove", onMoveTouch)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("touchend", onUp)
    }
  }, [draggingEdge])

  // --- Réinitialisation manuelle (NEEDS_CROP)
  const resetView = () => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDraggingEdge(null)
    setAnchorX(null)
    setAnchorY(null)
    setCropBox({
      top: 20,
      bottom: 80,
      left: 10,
      right: 90,
    })
    setIsCropping(true)
  }

  // --- retour en édition après validation (NEEDS_CROP)
  const reopenCrop = () => {
    setIsCropping(true)
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDraggingEdge(null)
    setAnchorX(null)
    setAnchorY(null)
  }

  // --- Validation du recadrage manuel (NEEDS_CROP)
  const confirmCrop = () => {
    if (!previewImgRef.current || !previewImage) return

    const imgEl = previewImgRef.current

    // dimensions d'affichage
    const displayRect = imgEl.getBoundingClientRect()
    const displayW = displayRect.width
    const displayH = displayRect.height

    // dimensions réelles
    const naturalW = imgEl.naturalWidth
    const naturalH = imgEl.naturalHeight

    // conversion % -> px affichés
    const cropLeftPx = (cropBox.left / 100) * displayW
    const cropRightPx = (cropBox.right / 100) * displayW
    const cropTopPx = (cropBox.top / 100) * displayH
    const cropBottomPx = (cropBox.bottom / 100) * displayH

    const innerWidthDisplayed =
      displayW - cropLeftPx - (displayW - cropRightPx)
    const innerHeightDisplayed =
      displayH - cropTopPx - (displayH - cropBottomPx)

    // ratio affichage -> pixels réels
    const scaleX = naturalW / displayW
    const scaleY = naturalH / displayH

    const srcX = cropLeftPx * scaleX
    const srcY = cropTopPx * scaleY
    const srcW = innerWidthDisplayed * scaleX
    const srcH = innerHeightDisplayed * scaleY

    if (srcW <= 0 || srcH <= 0) {
      console.warn("[LTV] recadrage annulé : dimensions nulles")
      return
    }

    // Canvas hors-DOM
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(srcW)
    canvas.height = Math.round(srcH)

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const imgObj = new Image()
    imgObj.onload = () => {
      ctx.drawImage(imgObj, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)
      const outDataUrl = canvas.toDataURL("image/png")

      setFinalCroppedUrl(outDataUrl)
      setIsCropping(false)

      // vue neutre post-validation
      setZoom(1)
      setPanX(0)
      setPanY(0)
      setDraggingEdge(null)
      setAnchorX(null)
      setAnchorY(null)
    }
    imgObj.src = previewImage
  }

  // --- Toggle entre previewImageDataUrl et altPreviewImageDataUrl en DISPLAY_DIRECT
  const toggleDisplayDirectImage = () => {
    if (lockedDisplayDirect) return
    if (!previewImage || !altPreviewImage) return

    setSelectedImage((prev) => {
      const next = prev === "main" ? "alt" : "main"
      const nextUrl = next === "main" ? previewImage : altPreviewImage
      setFinalCroppedUrl(nextUrl || null)
      return next
    })
  }

  // --- Validation du choix en DISPLAY_DIRECT (fige l'image affichée)
  const confirmDisplayDirectChoice = () => {
    setLockedDisplayDirect(true)
  }

  // ------------------------------------------------------------------
  // Rendu du tbody selon le mode
  // ------------------------------------------------------------------
  const renderBody = () => {
    console.log("[LTV] renderBody()", {
      ltvMode,
      isCropping,
      hasPreviewImage: !!previewImage,
      hasFinal: !!finalCroppedUrl,
    })

    // 1. DISPLAY_DIRECT -> on affiche les rows texte
    if (ltvMode === "DISPLAY_DIRECT" && rows.length > 0) {
      return (
        <tbody className="ltv-body-direct">
          {rows.map((r, idx) => {
            const check = (v: boolean) => (v ? "✓" : "")
            return (
              <tr key={r.code + "_" + idx}>
                {/* (CÓDIGO LTV) Trayecto / Estación */}
                <td
                  className="ltv-td"
                  style={{
                    textAlign: "left",
                    fontWeight: 600,
                    lineHeight: 1.2,
                    whiteSpace: "pre-line",
                  }}
                >
                  {`(${r.code}) ${r.section}`}
                </td>

                {/* Vía */}
                <td className="ltv-td">{r.via}</td>

                {/* Km. Ini */}
                <td className="ltv-td">{r.kmIni}</td>

                {/* Km. Fin */}
                <td className="ltv-td">{r.kmFin}</td>

                {/* Veloc. */}
                <td className="ltv-td">{r.speed}</td>

                {/* Motivo */}
                <td className="ltv-td" style={{ textAlign: "left" }}>
                  {r.motivo}
                </td>

                {/* Establecido · Fecha */}
                <td className="ltv-td">{r.fecha1}</td>

                {/* Establecido · Hora */}
                <td className="ltv-td">{r.hora1}</td>

                {/* Fin prevista · Fecha */}
                <td className="ltv-td">{r.fecha2}</td>

                {/* Fin prevista · Hora */}
                <td className="ltv-td">{r.hora2}</td>

                {/* No señalizada · Vía */}
                <td className="ltv-td">{check(r.viaCheck)}</td>

                {/* No señalizada · Sistema */}
                <td className="ltv-td">{check(r.sistema)}</td>

                {/* Sólo vehic. Cabeza */}
                <td className="ltv-td">{check(r.soloCabeza)}</td>

                {/* CSV */}
                <td className="ltv-td">{check(r.csv)}</td>

                {/* Observaciones */}
                <td
                  className="ltv-td"
                  style={{ textAlign: "left", whiteSpace: "pre-line" }}
                >
                  {r.observaciones}
                </td>
              </tr>
            )
          })}
        </tbody>
      )
    }

    // 2. NO_LTV -> pavé gris
    if (ltvMode === "NO_LTV") {
      return (
        <tbody className="ltv-body-noltv">
          <tr>
            <td className="ltv-td noltv-cell" colSpan={15}></td>
          </tr>
        </tbody>
      )
    }

    // 3. NEEDS_CROP
    if (ltvMode === "NEEDS_CROP") {
      // Cas 3a : pas d'image fournie par le parseur → fallback lisible
      if (!previewImage) {
        return (
          <tbody className="ltv-body-crop">
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  color: "#fff",
                  textAlign: "center",
                  padding: "4px 6px",
                  fontSize: "11px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Zona LTV detectada (NEEDS_CROP)
              </td>
            </tr>

            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#dedede",
                  color: "#000",
                  textAlign: "center",
                  padding: "12px 8px",
                  fontSize: "12px",
                  lineHeight: 1.4,
                  fontWeight: 600,
                }}
              >
                Aucune image à recadrer n’a été extraite du PDF.
                <br />
                (Pas de bitmap reçu du parseur v5.2)
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3b : image dispo, workflow normal recadrage
      if (isCropping && previewImage) {
        return (
          <tbody className="ltv-body-crop">
            {/* bandeau d'info */}
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  color: "#fff",
                  textAlign: "center",
                  padding: "4px 6px",
                  fontSize: "11px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Zona LTV extraída automáticamente (PDF)
              </td>
            </tr>

            {/* zone image / recadrage */}
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  padding: "6px",
                  textAlign: "center",
                }}
              >
                {/* viewport noir qui clippe */}
                <div
                  style={{
                    display: "inline-block",
                    textAlign: "center",
                    maxWidth: "100%",
                    maxHeight: "70vh",
                    overflow: "hidden",
                    position: "relative",
                    borderRadius: "4px",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.8)",
                    backgroundColor: "#000",
                  }}
                >
                  {/* conteneur zoomé/translaté */}
                  <div
                    ref={containerRef}
                    className="crop-container"
                    style={{
                      position: "relative",
                      display: "inline-block",
                      overflow: "visible",
                      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                      transformOrigin: "center center",
                      transition: draggingEdge
                        ? "none"
                        : "transform 0.2s ease-in-out",
                    }}
                  >
                    <img
                      ref={previewImgRef}
                      src={previewImage}
                      alt="LTV brute"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        border: "2px solid #fff",
                        borderRadius: "4px",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.5)",
                        display: "block",
                      }}
                    />

                    {/* Masque assombrissant hors zone recadrée */}
                    <div
                      className="crop-mask"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: "none",
                        zIndex: 5,
                        background: `
                          linear-gradient(
                            to bottom,
                            rgba(0,0,0,0.5) ${cropBox.top}%,
                            transparent ${cropBox.top}%,
                            transparent ${cropBox.bottom}%,
                            rgba(0,0,0,0.5) ${cropBox.bottom}%
                          ),
                          linear-gradient(
                            to right,
                            rgba(0,0,0,0.5) ${cropBox.left}%,
                            transparent ${cropBox.left}%,
                            transparent ${cropBox.right}%,
                            rgba(0,0,0,0.5) ${cropBox.right}%
                          )
                        `,
                      }}
                    />

                    {/* Bandes rouges déplaçables */}
                    <div
                      className="crop-edge top"
                      style={{ top: `${cropBox.top}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("top", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) =>
                        handleEdgeStart(
                          "top",
                          e.touches[0].clientX,
                          e.touches[0].clientY
                        )
                      }
                    />
                    <div
                      className="crop-edge bottom"
                      style={{ top: `${cropBox.bottom}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("bottom", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) =>
                        handleEdgeStart(
                          "bottom",
                          e.touches[0].clientX,
                          e.touches[0].clientY
                        )
                      }
                    />
                    <div
                      className="crop-edge left"
                      style={{ left: `${cropBox.left}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("left", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) =>
                        handleEdgeStart(
                          "left",
                          e.touches[0].clientX,
                          e.touches[0].clientY
                        )
                      }
                    />
                    <div
                      className="crop-edge right"
                      style={{ left: `${cropBox.right}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("right", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) =>
                        handleEdgeStart(
                          "right",
                          e.touches[0].clientX,
                          e.touches[0].clientY
                        )
                      }
                    />
                  </div>

                  {/* Boutons action */}
                  <div
                    style={{
                      marginTop: "8px",
                      display: "flex",
                      justifyContent: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      style={{
                        backgroundColor: "#1e40af",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "140px",
                      }}
                      onClick={confirmCrop}
                    >
                      Valider le recadrage
                    </button>

                    <button
                      style={{
                        backgroundColor: "#6b7280",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "140px",
                      }}
                      onClick={resetView}
                    >
                      Réinitialiser
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3c : image dispo, recadrage validé → affichage final figé cliquable
      if (!isCropping && finalCroppedUrl) {
        return (
          <tbody className="ltv-body-final">
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#fff",
                  padding: "0",
                  textAlign: "center",
                }}
              >
                <img
                  src={finalCroppedUrl}
                  alt="LTV validée"
                  style={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                    cursor: "pointer",
                    border: "0",
                    borderRadius: "0",
                    boxShadow: "none",
                    backgroundColor: "transparent",
                  }}
                  onClick={reopenCrop}
                />
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3d : NEEDS_CROP mais aucune image finale exploitable
      return (
        <tbody className="ltv-body-placeholder">
          <tr>
            <td className="ltv-td" colSpan={15}></td>
          </tr>
        </tbody>
      )
    }

    // 4. Affichage direct d'une image fournie (DISPLAY_DIRECT)
    if (ltvMode === "DISPLAY_DIRECT" && finalCroppedUrl) {
      // On peut basculer seulement si :
      // - pas encore validé
      // - il existe bien une alternative différente
      const canToggle =
        !lockedDisplayDirect &&
        previewImage &&
        altPreviewImage &&
        altPreviewImage !== previewImage

      return (
        <tbody className="ltv-body-final">
          <tr>
            <td
              className="ltv-td"
              colSpan={15}
              style={{
                backgroundColor: "#fff",
                padding: "0",
                textAlign: "center",
              }}
            >
              <img
                src={finalCroppedUrl}
                alt="LTV auto"
                style={{
                  width: "100%",
                  height: "auto",
                  display: "block",
                  border: "0",
                  borderRadius: "0",
                  boxShadow: "none",
                  backgroundColor: "transparent",
                  cursor: canToggle ? "pointer" : "default",
                }}
                onClick={() => {
                  if (canToggle) toggleDisplayDirectImage()
                }}
              />

              {/* Barre d'actions :
                 - affichée SEULEMENT tant que l'image n'est pas verrouillée
                 - disparaît totalement après validation */}
              {!lockedDisplayDirect && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                    padding: "8px 0 10px",
                    backgroundColor: "#fff",
                  }}
                >
                  {/* bouton basculer */}
                  {canToggle && (
                    <button
                      style={{
                        backgroundColor: "#1e3a8a",
                        color: "#fff",
                        fontSize: "13px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 10px",
                        border: "2px solid #000",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                        cursor: "pointer",
                        minWidth: "110px",
                        lineHeight: 1.2,
                      }}
                      onClick={toggleDisplayDirectImage}
                    >
                      Basculer{" "}
                      {selectedImage === "main" ? "(→ alt)" : "(→ main)"}
                    </button>
                  )}

                  {/* bouton valider */}
                  <button
                    style={{
                      backgroundColor: "#065f46",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      padding: "6px 10px",
                      border: "2px solid #000",
                      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                      cursor: "pointer",
                      minWidth: "110px",
                      lineHeight: 1.2,
                    }}
                    onClick={confirmDisplayDirectChoice}
                  >
                    Valider ✅
                  </button>
                </div>
              )}
            </td>
          </tr>
        </tbody>
      )
    }

    // 5. fallback
    return (
      <tbody className="ltv-body-placeholder">
        <tr>
          <td className="ltv-td" colSpan={15}></td>
        </tr>
      </tbody>
    )
  }

  // ------------------------------------------------------------------
  // Rendu global
  // ------------------------------------------------------------------
  return (
    <section className="ltv-wrap">
      <style>{`
        .ltv-wrap { background: transparent; }

        .ltv-table {
          border-collapse: collapse;
          width: 100%;
          table-layout: fixed;
          border: 2px solid #000;
          background: #fff;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: #000;
        }

        .ltv-table caption {
          caption-side: top;
          background: #dedede;
          color: #000;
          font-weight: 700;
          font-size: 15px;
          border: 2px solid #000;
          border-bottom: 0;
          letter-spacing: 0.3px;
          padding: 4px 0;
          line-height: 1.05;
        }

        .ltv-th, .ltv-td {
          border: 2px solid #000;
          color: #000;
          background: #fff;
          font-size: 11.5px;
          line-height: 1.15;
          text-align: center;
          font-weight: 600;
        }

        /* Cellules verticales (compat iPad) */
        .ltv-th.vert,
        .ltv-td.vert {
          font-size: 10.5px;
          font-weight: 600;
          line-height: 1.05;
          text-align: center;
          white-space: nowrap;
          vertical-align: middle;
          padding: 0 2px;
        }

        /* Boîte interne qui force la hauteur de la cellule verticale */
        .vert-shell {
          position: relative;
          height: 55px; /* validé */
          width: 100%;
          display: block;
        }

        /* Libellé vertical tourné + centré */
        .vert-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-90deg);
          transform-origin: center center;

          display: block;
          white-space: nowrap;
          line-height: 1.05;
          font-weight: 600;
          text-align: center;
          max-width: 100%;
        }

        /* Ajustement fin pour les libellés verticaux sur 2 lignes
           (ex: "Sólo vehic." / "Cabeza") */
        .vert-label-2l {
          transform: translate(-50%, -50%) rotate(-90deg) translateY(2px);
        }

        .ltv-th.left { text-align: left; font-weight: 700; }

        /* Largeurs recalées v3 (affinage post-capture)
           - Trayecto légèrement réduit
           - Motivo réduite
           - Solo/CSV corrigés
        */

        /* (CÓDIGO LTV) Trayecto / Estación */
        col.ltv-col-trayecto  { width: 21.43%; } /* (CÓDIGO LTV) Trayecto / Estación */

        /* Groupe B : Vía / Km Ini / Km Fin / Veloc. */
        col.ltv-col-via       { width: 2.23%; }  /* Vía */
        col.ltv-col-km        { width: 3.79%; }  /* Km. Ini */
        col.ltv-col-km2       { width: 3.68%; }  /* Km. Fin */
        col.ltv-col-vel       { width: 3.35%; }  /* Veloc. */

        /* Motivo */
        col.ltv-col-motivo    { width: 16.18%; } /* Motivo */

        /* Bloc Establecido / Fin prevista / No señalizada */
        col.ltv-col-small-a   { width: 5.13%; }  /* Establecido · Fecha */
        col.ltv-col-small-b   { width: 2.90%; }  /* Establecido · Hora */

        col.ltv-col-small-c   { width: 4.80%; }  /* Fin prevista · Fecha */
        col.ltv-col-small-d   { width: 3.13%; }  /* Fin prevista · Hora */

        col.ltv-col-small-e   { width: 6.03%; }  /* No señalizada · Vía */
        col.ltv-col-small-f   { width: 6.03%; }  /* No señalizada · Sistema */

        /* Sólo vehic. Cabeza */
        col.ltv-col-solo      { width: 3.13%; }  /* Sólo vehic. Cabeza */

        /* CSV (étroite) */
        col.ltv-col-csv-narrow { width: 2.34%; } /* CSV */

        /* Observaciones (dernière grande zone texte) */
        col.ltv-col-csv       { width: 15.85%; } /* Observaciones */


        .ltv-body-placeholder .ltv-td {
          height: 18px;
          font-weight: 400;
        }

        .ltv-body-noltv .noltv-cell {
          background: #dedede;
          border: 2px solid #000;
          height: 36px;
        }

        /* Mode sombre */
        .dark .ltv-table {
          border: 2px solid #fff;
          background: #000;
          color: #fff;
        }
        .dark .ltv-table caption {
          background: #444;
          color: #fff;
          border: 2px solid #fff;
          border-bottom: 0;
        }
        .dark .ltv-th,
        .dark .ltv-td {
          border: 2px solid #fff;
          color: #fff;
          background: #000;
        }
        .dark .ltv-body-noltv .noltv-cell {
          background: #333;
          border: 2px solid #fff;
          color: #fff;
        }

        /* inversion visuelle de l'image finale en mode sombre */
        .dark .ltv-body-final img {
          filter: invert(1) brightness(1.1);
          transition: filter 0.3s ease;
        }

        /* Bandes rouges de recadrage (hitbox large + ligne fine) */
        .crop-edge {
          position: absolute;
          background: transparent;
          z-index: 9999;
          cursor: grab;
          user-select: none;
          touch-action: none;
        }

        /* Horizontal edges (top & bottom) */
        .crop-edge.top,
        .crop-edge.bottom {
          height: 12px;            /* zone cliquable */
          left: 0;
          right: 0;
          transform: translateY(-50%);
        }

        /* Vertical edges (left & right) */
        .crop-edge.left,
        .crop-edge.right {
          width: 12px;             /* zone cliquable */
          top: 0;
          bottom: 0;
          transform: translateX(-50%);
        }

        /* Ligne rouge fine */
        .crop-edge::before {
          content: "";
          position: absolute;
          background: rgba(255, 0, 0, 0.6);
        }
        .crop-edge.top::before,
        .crop-edge.bottom::before {
          height: 2px;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
        }
        .crop-edge.left::before,
        .crop-edge.right::before {
          width: 2px;
          top: 0;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
        }

        @media print {
          .ltv-th, .ltv-td { font-size: 10.5px; }
          .ltv-th.vert, .ltv-td.vert { font-size: 10px; }
          .ltv-table caption { font-size: 14px; padding: 3px 0; }
        }
      `}</style>

      <table className="ltv-table">
        <caption>LTV</caption>

        {/* Largeurs de colonnes calées */}
        <colgroup>
          {/* 1. (CÓDIGO LTV) Trayecto / Estación [= fusion 2 premières colonnes du PDF] */}
          <col className="ltv-col-trayecto" />

          {/* 2. Vía */}
          <col className="ltv-col-via" />

          {/* 3. Km. Ini */}
          <col className="ltv-col-km" />

          {/* 4. Km. Fin */}
          <col className="ltv-col-km2" />

          {/* 5. Veloc. */}
          <col className="ltv-col-vel" />

          {/* 6. Motivo */}
          <col className="ltv-col-motivo" />

          {/* 7-12. Colonnes techniques */}
          <col className="ltv-col-small-a" />
          <col className="ltv-col-small-b" />
          <col className="ltv-col-small-c" />
          <col className="ltv-col-small-d" />
          <col className="ltv-col-small-e" />
          <col className="ltv-col-small-f" />

          {/* 13. Sólo vehic. Cabeza */}
          <col className="ltv-col-solo" />

          {/* 14. CSV (col étroite dédiée) */}
          <col className="ltv-col-csv-narrow" />

          {/* 15. Observaciones (large bloc texte) */}
          <col className="ltv-col-csv" />
        </colgroup>

        <thead>
          <tr>
            <th className="ltv-th left" rowSpan={2}>
              (CÓDIGO LTV) Trayecto / Estación
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Vía</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Km. Ini</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Km. Fin</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Veloc.</span>
              </div>
            </th>

            <th className="ltv-th" rowSpan={2}>
              Motivo
            </th>

            <th className="ltv-th" colSpan={2}>
              Establecido
            </th>

            <th className="ltv-th" colSpan={2}>
              Fin prevista
            </th>

            <th className="ltv-th" colSpan={2}>
              No señalizada
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label vert-label-2l">
                  Sólo vehic.<br />
                  Cabeza
                </span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">CSV</span>
              </div>
            </th>

            <th className="ltv-th" rowSpan={2}>
              Observaciones
            </th>
          </tr>

          <tr>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Fecha</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Hora</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Fecha</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Hora</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Vía</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Sistema</span>
              </div>
            </th>
          </tr>
        </thead>

        {renderBody()}
      </table>
    </section>
  )
}

export default LTV
