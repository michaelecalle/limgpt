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

export default function App() {
  const [pdfMode, setPdfMode] = React.useState<"blue" | "green" | "red">("blue")
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof document === "undefined") return false
    const html = document.documentElement
    return html.classList.contains("dark") || html.getAttribute("data-theme") === "dark"
  })
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null)
  const [pdfPageImages, setPdfPageImages] = React.useState<string[]>([])
  const [debugLines, setDebugLines] = React.useState<string[]>([])

  function pushDebug(msg: string) {
    setDebugLines((prev) => {
      const line = new Date().toISOString().slice(11, 19) + " " + msg
      return [line, ...prev].slice(0, 40)
    })
  }

  // réception du PDF
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const file = ce.detail?.file as File | undefined
      if (file) {
        pushDebug(`lim:import-pdf reçu: ${file.name}`)

        const url = URL.createObjectURL(file)
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return url
        })

        // parser rouge (images)
        window.dispatchEvent(
          new CustomEvent("lim:pdf-raw", {
            detail: { file },
          })
        )
        pushDebug("event lim:pdf-raw émis")

        // parser FT (il écoute ft:import-pdf, pas lim:import-pdf)
        window.dispatchEvent(
          new CustomEvent("ft:import-pdf", {
            detail: { file },
          })
        )
        pushDebug("event ft:import-pdf émis")
      }
    }
    window.addEventListener("lim:import-pdf", handler as EventListener)
    return () => {
      window.removeEventListener("lim:import-pdf", handler as EventListener)
    }
  }, [])

  // changement de mode
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce.detail?.mode as "blue" | "green" | "red" | undefined
      if (mode) {
        setPdfMode(mode)
      }
    }
    window.addEventListener("lim:pdf-mode-change", handler as EventListener)
    return () => {
      window.removeEventListener("lim:pdf-mode-change", handler as EventListener)
    }
  }, [])

  // images de pages (parser rouge)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const images = ce.detail?.images as string[] | undefined
      if (Array.isArray(images)) {
        pushDebug(`images reçues du parser rouge: ${images.length}`)
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

  // logs en provenance des parseurs (si jamais on en émet côté parseur)
  React.useEffect(() => {
    const onLimParsed = (e: Event) => {
      const ce = e as CustomEvent
      pushDebug("lim:parsed reçu (infos LIM)")
      // on pourrait logguer ce.detail ici si besoin
    }
    const onFtParsed = (e: Event) => {
      const ce = e as CustomEvent
      pushDebug("ft:parsedRaw reçu (FT)")
    }
    window.addEventListener("lim:parsed", onLimParsed as EventListener)
    window.addEventListener("ft:parsedRaw", onFtParsed as EventListener)
    return () => {
      window.removeEventListener("lim:parsed", onLimParsed as EventListener)
      window.removeEventListener("ft:parsedRaw", onFtParsed as EventListener)
    }
  }, [])

  return (
    <main className="p-2 sm:p-4 h-screen flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        <TitleBar />

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

        {/* MODE VERT : on le rend toujours mais on le cache si pas vert */}
        <div
          className={
            pdfMode === "green"
              ? "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col"
              : "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col hidden"
          }
        >
          <div className="mt-0">
            <Infos />
          </div>

          <div className="mt-3">
            <LTV />
          </div>

          <div className="mt-3 flex-1 min-h-0">
            <FT />
          </div>
        </div>
      </div>

      {/* petit panneau de debug iPad en bas à droite */}
      <div className="fixed bottom-2 right-2 z-50 max-h-40 w-72 overflow-auto rounded-md bg-black/80 text-xs text-green-200 p-2">
        <div className="font-bold mb-1">DEBUG iPad</div>
        {debugLines.length === 0 ? (
          <div className="text-zinc-400">aucun log pour l’instant</div>
        ) : (
          <ul className="space-y-1">
            {debugLines.map((l, i) => (
              <li key={i} className="leading-tight">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
