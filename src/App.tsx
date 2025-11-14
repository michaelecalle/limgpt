// src/App.tsx

import "./lib/ltvParser"
import "./lib/redPdfParser"
import "./lib/limParser"
import "./lib/ftParser"
import React from "react"

import TitleBar from "./components/LIM/TitleBar"
import Infos from "./components/LIM/Infos"
import LTV from "./components/LIM/LTV"
import FT from "./components/LIM/FT"
import { APP_VERSION } from "./components/version"

/**
 * App.tsx — version propre de l'écran LIM.
 *
 * BUT :
 * - Afficher une seule FT (celle gérée par components/LIM/FT.tsx,
 *   celle avec les lignes intermédiaires, vitesses, fusion des lignes rouges).
 * - Réafficher LTV.
 * - SUPPRIMER l'ancien rendu FT de preview.
 * - Garder les 3 modes (bleu / vert / rouge).
 */

export default function App() {
  const [pdfMode, setPdfMode] = React.useState<"blue" | "green" | "red">("blue")
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof document === "undefined") return false
    const html = document.documentElement
    return html.classList.contains("dark") || html.getAttribute("data-theme") === "dark"
  })
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null)
  const [rawPdfFile, setRawPdfFile] = React.useState<File | null>(null)
  const [pdfPageImages, setPdfPageImages] = React.useState<string[]>([])

  // 👇 nouveau: référence vers la vidéo “keep awake”
  const keepAwakeRef = React.useRef<HTMLVideoElement | null>(null)

  // === GPS LAB – état et logique de log ===
  type GpsPoint = {
    timestamp: string
    lat: number
    lon: number
    accuracy?: number
    speed?: number
    heading?: number
  }

  const [gpsLogging, setGpsLogging] = React.useState(false)
  const [gpsPoints, setGpsPoints] = React.useState<GpsPoint[]>([])
  const [gpsError, setGpsError] = React.useState<string | null>(null)
  const gpsWatchIdRef = React.useRef<number | null>(null)

  const startGpsLogging = React.useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGpsError("GPS non disponible sur cet appareil.")
      return
    }
    setGpsError(null)

    if (gpsWatchIdRef.current !== null) {
      // déjà en cours
      return
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed, heading } = pos.coords
        const ts = new Date(pos.timestamp).toISOString()

        setGpsPoints((prev) => [
          ...prev,
          {
            timestamp: ts,
            lat: latitude,
            lon: longitude,
            accuracy,
            speed: speed ?? undefined,
            heading: heading ?? undefined,
          },
        ])
      },
      (err) => {
        console.error("[GPS LAB] Erreur geolocation:", err)
        setGpsError(err.message || "Erreur GPS.")
        setGpsLogging(false)
        if (gpsWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current)
          gpsWatchIdRef.current = null
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    gpsWatchIdRef.current = id
    setGpsLogging(true)
  }, [])

  const stopGpsLogging = React.useCallback(() => {
    if ("geolocation" in navigator && gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current)
      gpsWatchIdRef.current = null
    }
    setGpsLogging(false)
  }, [])

  const downloadGpsCsv = React.useCallback(() => {
    if (gpsPoints.length === 0) {
      setGpsError("Aucun point GPS à exporter.")
      return
    }

    const header = "timestamp;lat;lon;accuracy_m;speed_mps;heading_deg\n"
    const lines = gpsPoints.map((p) => {
      const acc = p.accuracy ?? ""
      const spd = p.speed ?? ""
      const hdg = p.heading ?? ""
      return `${p.timestamp};${p.lat.toFixed(7)};${p.lon.toFixed(7)};${acc};${spd};${hdg}`
    })
    const csv = header + lines.join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")

    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, "0")
    const filename = `gps_log_${now.getFullYear()}${pad(
      now.getMonth() + 1
    )}${pad(now.getDate())}_${pad(now.getHours())}${pad(
      now.getMinutes()
    )}${pad(now.getSeconds())}.csv`

    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [gpsPoints])

  // nettoyage du watchPosition si on quitte la page
  React.useEffect(() => {
    return () => {
      if ("geolocation" in navigator && gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current)
        gpsWatchIdRef.current = null
      }
    }
  }, [])
  // === FIN GPS LAB ===

  // 👇 fonction qui essaie de lire la vidéo discrètement
  const tryPlayKeepAwake = React.useCallback(() => {
    const vid = keepAwakeRef.current
    if (!vid) return
    // certaines versions d’iOS n’aiment pas les play() silencieux → on attrape l’erreur et on l’ignore
    void vid.play().catch(() => {
      // rien, c’est juste pour éviter un warning
    })
  }, [])

  // réception du PDF
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const file = ce.detail?.file as File | undefined
      if (file) {
        setRawPdfFile(file)
        console.log("[App] PDF brut reçu =", file)

        // URL pour l'iframe (mode rouge sans images)
        const url = URL.createObjectURL(file)
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return url
        })

        // on réémet le même fichier pour le parser rouge (images)
        window.dispatchEvent(
          new CustomEvent("lim:pdf-raw", {
            detail: { file },
          })
        )

        // on réémet aussi pour le parser FT (sinon le tableau ne se remplit pas)
        window.dispatchEvent(
          new CustomEvent("ft:import-pdf", {
            detail: { file },
          })
        )

        // à chaque import, on relance la vidéo
        tryPlayKeepAwake()
      }
    }
    window.addEventListener("lim:import-pdf", handler as EventListener)
    return () => {
      window.removeEventListener("lim:import-pdf", handler as EventListener)
    }
  }, [tryPlayKeepAwake])

  // changement de mode (blue/green/red)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce.detail?.mode as "blue" | "green" | "red" | undefined
      if (mode) {
        console.log("[App] mode reçu =", mode)
        setPdfMode(mode)
        // on profite de chaque action de l’utilisateur pour relancer la vidéo
        tryPlayKeepAwake()
      }
    }
    window.addEventListener("lim:pdf-mode-change", handler as EventListener)
    return () => {
      window.removeEventListener("lim:pdf-mode-change", handler as EventListener)
    }
  }, [tryPlayKeepAwake])

  // images de pages (parser rouge)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const images = ce.detail?.images as string[] | undefined
      if (Array.isArray(images)) {
        console.log("[App] images de pages reçues =", images)
        setPdfPageImages(images)
      }
    }
    window.addEventListener("lim:pdf-page-images", handler as EventListener)
    return () => {
      window.removeEventListener("lim:pdf-page-images", handler as EventListener)
    }
  }, [])

  // thème
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const dark = !!ce.detail?.dark
      setIsDark(dark)
    }
    window.addEventListener("lim:theme-change", handler as EventListener)
    return () => {
      window.removeEventListener("lim:theme-change", handler as EventListener)
    }
  }, [])

  // 👇 au premier rendu, on tente une fois de plus
  React.useEffect(() => {
    tryPlayKeepAwake()
  }, [tryPlayKeepAwake])

  return (
    <main className="p-2 sm:p-4 h-screen flex flex-col">
      {/* petite vidéo muette, invisible, pour empêcher la veille iPad */}
      {/* place un fichier dans public/keepawake.mp4 */}
      <video
        ref={keepAwakeRef}
        src="/keepawake.mp4"
        muted
        playsInline
        loop
        style={{ width: 0, height: 0, opacity: 0, position: "absolute", pointerEvents: "none" }}
      />

      {/* conteneur principal */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Bandeau titre */}
        <TitleBar />

        {/* GPS LAB — panneau de log simple */}
        <div className="mt-2 mb-1 rounded-xl border border-dashed border-zinc-400/40 dark:border-zinc-600/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 bg-zinc-50/80 dark:bg-zinc-900/60">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-semibold">GPS Lab (labo uniquement)</span>
              <span className="text-[0.7rem] text-zinc-500 dark:text-zinc-400">
                Enregistre les positions GPS pour analyse hors ligne (ruban LAV 050).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={gpsLogging ? stopGpsLogging : startGpsLogging}
                className={
                  gpsLogging
                    ? "px-3 py-1 rounded-full text-xs font-semibold bg-red-500 text-white"
                    : "px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white"
                }
              >
                {gpsLogging ? "Stop GPS log" : "Start GPS log"}
              </button>
              <button
                type="button"
                onClick={downloadGpsCsv}
                className="px-3 py-1 rounded-full text-xs font-semibold border border-zinc-400 dark:border-zinc-500"
              >
                Export CSV
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[0.7rem]">
            <div>
              Points : <span className="font-mono">{gpsPoints.length}</span>
              {gpsLogging && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  ● enregistrement en cours
                </span>
              )}
            </div>
            {gpsError && (
              <div className="text-rose-600 dark:text-rose-400 truncate max-w-[50%] text-right">
                {gpsError}
              </div>
            )}
          </div>
        </div>

        {/* MODE BLEU : rendu dédié */}
        {pdfMode === "blue" && (
          <div className="mt-3 flex-1 min-h-0">
            <div
              className={
                isDark
                  ? "h-full flex flex-col items-center justify-center rounded-2xl bg-black text-zinc-500"
                  : "h-full flex flex-col items-center justify-center rounded-2xl bg-zinc-100 text-zinc-200"
              }
            >
              <div className="text-[600px] leading-none font-semibold tracking-tight select-none">
                LIM
              </div>
              <div className="mt-2 text-7xl italic tracking-wide select-none">
                Version {APP_VERSION}
              </div>
            </div>
          </div>
        )}

        {/* MODE ROUGE : rendu dédié */}
        {pdfMode === "red" && (
          <div className="mt-3 flex-1 min-h-0">
            <div
              className={
                isDark
                  ? "h-full rounded-2xl bg-black/80 overflow-auto"
                  : "h-full rounded-2xl bg-zinc-100 overflow-auto"
              }
            >
              {pdfPageImages.length > 0 ? (
                <div className="flex flex-col gap-4 p-4">
                  {pdfPageImages.map((src, idx) => (
                    <img
                      key={idx}
                      src={src}
                      alt={`Page PDF ${idx + 1}`}
                      className="w-full h-auto rounded-lg shadow"
                      style={
                        isDark
                          ? {
                              filter: "invert(1) hue-rotate(180deg)",
                              backgroundColor: "black",
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : pdfUrl ? (
                <iframe src={pdfUrl} className="w-full h-full rounded-2xl" title="PDF importé" />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                  Aucun PDF chargé. Importez un PDF puis passez en mode secours.
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODE VERT : on le REND TOUJOURS mais on le CACHE si pas vert */}
        <div
          className={
            pdfMode === "green"
              ? "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col"
              : "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col hidden"
          }
        >
          {/* Bloc infos */}
          <div className="mt-0">
            <Infos />
          </div>

          {/* Bloc LTV */}
          <div className="mt-3">
            <LTV />
          </div>

          {/* Bloc FT */}
          <div className="mt-3 flex-1 min-h-0">
            <FT />
          </div>
        </div>
      </div>
    </main>
  )
}
