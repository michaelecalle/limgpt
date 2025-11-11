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
  const [rawPdfFile, setRawPdfFile] = React.useState<File | null>(null)
  const [pdfPageImages, setPdfPageImages] = React.useState<string[]>([])

  // réception du PDF
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const file = ce.detail?.file as File | undefined
      if (file) {
        setRawPdfFile(file)
        const url = URL.createObjectURL(file)
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return url
        })

        // on réémet le même fichier pour le parser rouge
        window.dispatchEvent(
          new CustomEvent("lim:pdf-raw", {
            detail: { file },
          })
        )
        // et pour le FT
        window.dispatchEvent(
          new CustomEvent("ft:import-pdf", {
            detail: { file },
          })
        )
      }
    }
    window.addEventListener("lim:import-pdf", handler as EventListener)
    return () => {
      window.removeEventListener("lim:import-pdf", handler as EventListener)
    }
  }, [])

  // changement de mode (blue/green/red)
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

  return (
    <main className="p-2 sm:p-4 h-screen flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        <TitleBar />

        {/* MODE BLEU */}
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

        {/* MODE ROUGE */}
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

        {/* MODE VERT */}
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
    </main>
  )
}
