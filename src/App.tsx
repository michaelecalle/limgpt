// src/App.tsx
// DEV ONLY — Sniffer des events écoutés via window.addEventListener
(() => {
  const w = window as any;
  if (w.__limgptSnifferInstalled) return;
  w.__limgptSnifferInstalled = true;

  const original = window.addEventListener.bind(window);
  const seen = new Map<string, number>();

  window.addEventListener = ((type: any, listener: any, options?: any) => {
    const t = String(type);
    seen.set(t, (seen.get(t) ?? 0) + 1);

    // Expose dans window pour lecture facile
    w.__limgptListeners = Object.fromEntries(seen.entries());

    // Log console utile (filtre sur custom events)
    if (t.includes(":")) console.log("[listener]", t);

    return original(type, listener as any, options);
  }) as any;

  console.log("[limgpt] addEventListener sniffer installed");
})();
// DEV ONLY — Sniffer des events dispatchés
(() => {
  const w = window as any;
  if (w.__limgptDispatchSnifferInstalled) return;
  w.__limgptDispatchSnifferInstalled = true;

  const original = window.dispatchEvent.bind(window);
  const seen = new Map<string, number>();

  window.dispatchEvent = ((evt: Event) => {
    const t = (evt as any)?.type ? String((evt as any).type) : "unknown";
    seen.set(t, (seen.get(t) ?? 0) + 1);
    w.__limgptDispatched = Object.fromEntries(seen.entries());

    if (t.includes(":")) console.log("[dispatch]", t, (evt as any).detail ?? "");
    return original(evt);
  }) as any;

  console.log("[limgpt] dispatchEvent sniffer installed");
})();
// DEV ONLY — Sniffer des events dispatchés
(() => {
  const w = window as any;
  if (w.__limgptDispatchSnifferInstalled) return;
  w.__limgptDispatchSnifferInstalled = true;

  const original = window.dispatchEvent.bind(window);
  const seen = new Map<string, number>();

  window.dispatchEvent = ((evt: Event) => {
    const t = (evt as any)?.type ? String((evt as any).type) : "unknown";
    seen.set(t, (seen.get(t) ?? 0) + 1);
    w.__limgptDispatched = Object.fromEntries(seen.entries());

    if (t.includes(":")) console.log("[dispatch]", t, (evt as any).detail ?? "");
    return original(evt);
  }) as any;

  console.log("[limgpt] dispatchEvent sniffer installed");
})();


import "./lib/ltvParser"
import "./lib/redPdfParser"
import "./lib/limParser"
import "./lib/ftParser"
import React from "react"
import FTFrance from "./components/LIM/FTFrance"


import TitleBar from "./components/LIM/TitleBar"
import Infos from "./components/LIM/Infos"
import LTV from "./components/LIM/LTV"
import FT from "./components/LIM/FT"
import ReplayOverlay from "./components/Replay/ReplayOverlay"
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
  const [foldInfosLtv, setFoldInfosLtv] = React.useState(false)

  const [isDark, setIsDark] = React.useState(() => {
    if (typeof document === "undefined") return false
    const html = document.documentElement
    return (
      html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark"
    )
  })

  // ✅ Toast "mise à jour" (déclenché si APP_VERSION change)
  const [updateToastOpen, setUpdateToastOpen] = React.useState(false)
  const [updatePrevVersion, setUpdatePrevVersion] = React.useState<string | null>(null)

  React.useEffect(() => {
    try {
      const KEY = "lim:lastVersionSeen"
      const last = localStorage.getItem(KEY)

      if (last && last !== APP_VERSION) {
        setUpdatePrevVersion(last)
        setUpdateToastOpen(true)
        window.setTimeout(() => setUpdateToastOpen(false), 8000)
      }

      localStorage.setItem(KEY, APP_VERSION)
    } catch {
      // non bloquant
    }
  }, [])

  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null)
  const [rawPdfFile, setRawPdfFile] = React.useState<File | null>(null)
  const [pdfPageImages, setPdfPageImages] = React.useState<string[]>([])

  // ============================================================
  // FT VIEW MODE + OVERLAY FT FRANCE (opaque)
  // ============================================================
  type FtViewMode = "AUTO" | "ES" | "FR"
  const [ftViewMode, setFtViewMode] = React.useState<FtViewMode>("ES")
  const [trainNumber, setTrainNumber] = React.useState<number | null>(null)

  // Critère "FT France disponible" (déjà en place : whitelist par n° de train)
  const FT_FR_WHITELIST = React.useMemo(
    () => new Set<number>([9712, 9714, 9707, 9709, 9705, 9710]),
    []
  )

  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce?.detail?.mode
      if (mode === "AUTO" || mode === "ES" || mode === "FR") setFtViewMode(mode)
    }
    window.addEventListener("ft:view-mode-change", handler as EventListener)
    return () =>
      window.removeEventListener("ft:view-mode-change", handler as EventListener)
  }, [])

  React.useEffect(() => {
    const readTrain = (e: Event) => {
      const ce = e as CustomEvent
      const raw = ce?.detail?.trainNumber
      const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
      if (!Number.isNaN(n)) setTrainNumber(n)
    }

    window.addEventListener("lim:train", readTrain as EventListener)
    window.addEventListener("lim:train-change", readTrain as EventListener)
    return () => {
      window.removeEventListener("lim:train", readTrain as EventListener)
      window.removeEventListener("lim:train-change", readTrain as EventListener)
    }
  }, [])

  const showFtFranceOverlay =
    ftViewMode === "FR" &&
    trainNumber !== null &&
    FT_FR_WHITELIST.has(trainNumber)

  // ============================================================
  // Mesure zone LTV/FT pour overlay "fixed" (iPad PWA safe)
  // ============================================================
  const ftAreaRef = React.useRef<HTMLDivElement | null>(null)
  const [ftAreaRect, setFtAreaRect] = React.useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  React.useLayoutEffect(() => {
    if (!showFtFranceOverlay) return

    const measure = () => {
      const el = ftAreaRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setFtAreaRect({ top: r.top, left: r.left, width: r.width })
    }

    measure()
    const raf = window.requestAnimationFrame(measure)

    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)

    const vv = window.visualViewport
    vv?.addEventListener("resize", measure)
    vv?.addEventListener("scroll", measure)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener("resize", measure)
      window.removeEventListener("orientationchange", measure)
      vv?.removeEventListener("resize", measure)
      vv?.removeEventListener("scroll", measure)
    }
  }, [showFtFranceOverlay])

  // ✅ Sécurité (ceinture & bretelles) :
  // si train non éligible FT France => forcer ADIF (ES), même si un event UI tente FR/AUTO
  React.useEffect(() => {
    if (trainNumber === null) return

    const isEligible = FT_FR_WHITELIST.has(trainNumber)

    if (!isEligible && ftViewMode !== "ES") {
      setFtViewMode("ES")
      console.log("[App] FT view forced to ES (train not eligible)", {
        trainNumber,
        previous: ftViewMode,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainNumber])


  // ============================================================
  // REPLAY BOOTSTRAP (sans UI) — expose un player dans la console
  // ============================================================
  React.useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const mod = await import("./lib/replay/replayPlayer")
        const ReplayPlayer = mod.ReplayPlayer

        const player = new ReplayPlayer({
          logger: (msg: string, data?: any) => console.log(msg, data ?? ""),
          forceSimulation: true,
        })

        // Exposition console (dev)
        ;(window as any).__limgptReplay = {
          player,

          // helpers pratiques
          loadUrl: async (url: string) => {
            await player.loadFromUrl(url)
            console.log("[replay] loaded", {
              status: player.getStatus(),
              durationMs: player.getDurationMs(),
              cursor: player.getCursor(),
            })
          },

          play: () => player.play(),
          pause: () => player.pause(),
          stop: () => player.stop(),
          seek: (tMs: number) => player.seek(tMs),
          speed: (x: number) => player.setSpeed(x),

          status: () => player.getStatus(),
          cursor: () => player.getCursor(),
          durationMs: () => player.getDurationMs(),
          startIso: () => player.getStartIso?.() ?? null,
          nowIso: () => player.getNowIso?.() ?? null,

          error: () => player.getError?.() ?? null,
        }

        if (!cancelled) {
          console.log("[replay] bootstrap OK → window.__limgptReplay")
        }
      } catch (err) {
        console.warn("[replay] bootstrap failed", err)
      }
    })()

    return () => {
      cancelled = true
      // on ne stoppe pas forcément le player ici ; dev-only
    }
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
        console.log("[App] mode reçu =", mode)
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

  // pliage INFOS/LTV (événement envoyé par TitleBar)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const folded = !!ce.detail?.folded
      setFoldInfosLtv(folded)
    }
    window.addEventListener(
      "lim:infos-ltv-fold-change",
      handler as EventListener
    )
    return () => {
      window.removeEventListener(
        "lim:infos-ltv-fold-change",
        handler as EventListener
      )
    }
  }, [])

  return (
    <main className="p-2 sm:p-4 min-h-[100dvh] flex flex-col">
      {/* conteneur principal */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Bandeau titre */}
        <TitleBar />
        <ReplayOverlay />

        {/* ✅ Toast mise à jour */}
        {updateToastOpen && (
          <div className="fixed top-3 right-3 z-[99999]">
            <div className="rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm">
              <div className="font-semibold">✅ LIM a été mise à jour</div>
              <div className="mt-1 text-xs opacity-70">
                {updatePrevVersion ? (
                  <>
                    {updatePrevVersion} → {APP_VERSION}
                  </>
                ) : (
                  APP_VERSION
                )}
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setUpdateToastOpen(false)
                    window.dispatchEvent(new CustomEvent("lim:about-open"))
                  }}
                  className="text-xs font-semibold underline opacity-80 hover:opacity-100"
                >
                  Voir le changelog
                </button>

                <button
                  type="button"
                  onClick={() => setUpdateToastOpen(false)}
                  className="text-xs font-semibold px-2 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/70"
                >
                  OK
                </button>
              </div>
            </div>
          </div>

        )}



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
                <iframe
                  src={pdfUrl}
                  className="w-full h-full rounded-2xl"
                  title="PDF importé"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                  Aucun PDF chargé. Importez un PDF puis passez en mode
                  secours.
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
          <div className={foldInfosLtv ? "hidden" : "block"}>
            {/* Bloc infos */}
            <div className="mt-0">
              <Infos />
            </div>

            {/* Zone LTV + FT (overlay FT France possible) */}
            <div ref={ftAreaRef} className="mt-3 flex-1 min-h-0 relative flex flex-col">
              {/* Bloc LTV */}
              <div className={foldInfosLtv ? "hidden" : "block"}>
                <LTV />
              </div>

              {/* Bloc FT */}
              <div
                className={
                  foldInfosLtv
                    ? "mt-0 flex-1 min-h-0 h-full"
                    : "mt-3 flex-1 min-h-0"
                }
              >
                <FT />
              </div>

              {/* Overlay FT France (opaque) — fixé au viewport, top aligné sur la zone LTV/FT */}
              {showFtFranceOverlay && ftAreaRect && (
                <div
                  className={
                    "z-50 rounded-2xl border shadow-lg pointer-events-auto overflow-hidden " +
                    (isDark
                      ? "bg-zinc-950 border-zinc-800"
                      : "bg-white border-zinc-200")
                  }
                  style={{
                    position: "fixed",
                    top: ftAreaRect.top,
                    left: ftAreaRect.left,
                    width: ftAreaRect.width,
                    bottom: 0,
                  }}
                >
                  <div className={"h-full w-full p-3 " + (isDark ? "bg-zinc-950" : "bg-white")}>
                    <FTFrance trainNumber={trainNumber} />
                  </div>
                </div>
              )}



            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
