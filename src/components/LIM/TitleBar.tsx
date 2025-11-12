import { useEffect, useMemo, useRef, useState } from 'react'

type LIMFields = {
  tren?: string
  trenPadded?: string
}

function toTitleNumber(s?: string | null): string | undefined {
  if (!s) return undefined
  const m = String(s).match(/\d{1,}/)
  if (!m) return undefined
  const n = parseInt(m[0], 10)
  if (!Number.isFinite(n)) return undefined
  return String(n)
}

/**
 * TitleBar — LIMGPT α2.1 (+ keep-awake video trigger)
 */
export default function TitleBar() {
  // ----- HORLOGE -----
  const formatTime = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  const [clock, setClock] = useState(() => formatTime(new Date()))
  const [autoScroll, setAutoScroll] = useState(false)
  const [gpsState, setGpsState] = useState<0 | 1 | 2>(0)
  const [hourlyMode, setHourlyMode] = useState(false)
  const [pdfMode, setPdfMode] = useState<'blue' | 'green' | 'red'>('blue')
  // avance/retard affiché à côté de l'heure (ex: "+3 min" ou "-1 min")
  const [scheduleDelta, setScheduleDelta] = useState<string | null>(null)
    const [scheduleDeltaIsLarge, setScheduleDeltaIsLarge] = useState(false)



  // ➜ vidéo de réveil
  const keepAwakeRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('lim:pdf-mode-change', { detail: { mode: pdfMode } })
    )
  }, [pdfMode])

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime(new Date())), 1000)
    return () => clearInterval(t)
  }, [])

  // ----- HELPERS DOM -----
  const getMainEl = (): HTMLElement | null => {
    const explicit = document.querySelector('main') as HTMLElement | null
    if (explicit) return explicit
    const self = document.getElementById('lim-titlebar-root') as HTMLElement | null
    return self?.closest('main') as HTMLElement | null
  }
  const getRootEl = (): HTMLElement | null => {
    return (document.getElementById('root') ||
      document.getElementById('__next')) as HTMLElement | null
  }

  // ----- THEME Jour/Nuit -----
  const getInitialDark = () => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') return true
    if (stored === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  }
  const [dark, setDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const main = getMainEl()
    const applyTheme = (on: boolean) => {
      const m = on ? 'add' : 'remove'
      root.classList[m]('dark')
      body.classList[m]('dark')
      if (main) main.classList[m]('dark')
      root.setAttribute('data-theme', on ? 'dark' : 'light')
      body.setAttribute('data-theme', on ? 'dark' : 'light')
      if (main) main.setAttribute('data-theme', on ? 'dark' : 'light')
      try {
        localStorage.setItem('theme', on ? 'dark' : 'light')
      } catch {}
      window.dispatchEvent(new CustomEvent('lim:toggle-theme', { detail: { dark: on } }))
      window.dispatchEvent(new CustomEvent('lim:theme-change', { detail: { dark: on } }))
    }
    applyTheme(dark)
  }, [dark])

  // ----- LUMINOSITÉ -----
  const getInitialBrightness = () => {
    if (typeof window === 'undefined') return 1
    const raw = localStorage.getItem('brightness')
    if (!raw) return 1
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    const value = n > 3 ? Math.max(0.5, n / 100) : Math.max(0.5, n)
    return Math.min(1, value)
  }
  const [brightness, setBrightness] = useState<number>(getInitialBrightness)

  useEffect(() => {
    const b = `brightness(${brightness})`
    const html = document.documentElement
    const body = document.body
    const root = getRootEl()
    const main = getMainEl()
    ;[html, body, root, main].forEach((el) => {
      if (el) (el as HTMLElement).style.filter = ''
    })
    if (main) (main as HTMLElement).style.filter = b
    if (root) (root as HTMLElement).style.filter = b
    body.style.filter = b
    html.style.filter = b
    try {
      localStorage.setItem('brightness', String(brightness))
    } catch {}
    window.dispatchEvent(new CustomEvent('lim:brightness-change', { detail: { brightness } }))
    return () => {
      ;[html, body, root, main].forEach((el) => {
        if (el) (el as HTMLElement).style.filter = ''
      })
    }
  }, [brightness])

  const brightnessPct = useMemo(() => Math.round(brightness * 100), [brightness])

  // ----- IMPORT PDF -----
  const inputRef = useRef<HTMLInputElement>(null)
  const handleImportClick = () => inputRef.current?.click()
  const onPickPdf: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      window.dispatchEvent(new CustomEvent('lim:import-pdf', { detail: { file } }))
      window.dispatchEvent(new CustomEvent('ft:import-pdf', { detail: { file } }))
      window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file } }))
      setPdfMode('green')

      // 👉 on tente de lancer la vidéo keep-awake juste après le geste utilisateur
      const v = keepAwakeRef.current
      if (v) {
        v.play().catch((err) => {
          console.warn('[keepawake] play() refusé', err)
        })
      }
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  // ----- NUMÉRO DE TRAIN -----
  const [trainDisplay, setTrainDisplay] = useState<string | undefined>(() => {
    const w = window as any
    const last: LIMFields | undefined = w.__limLastParsed
    const raw = last?.trenPadded ?? last?.tren
    return toTitleNumber(raw)
  })
  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail
      const raw = detail.trenPadded ?? detail.tren
      const disp = toTitleNumber(raw)
      setTrainDisplay(disp)
    }
    const onTrain = (e: Event) => {
      const ce = e as CustomEvent
      const val = (ce.detail as any)?.train as string | undefined
      const disp = toTitleNumber(val)
      if (disp) setTrainDisplay(disp)
    }
    window.addEventListener('lim:parsed', onParsed as EventListener)
    window.addEventListener('lim:train', onTrain as EventListener)
    return () => {
      window.removeEventListener('lim:parsed', onParsed as EventListener)
      window.removeEventListener('lim:train', onTrain as EventListener)
    }
  }, [])
  // écoute les mises à jour d'avance/retard envoyées par le reste de l'app
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const text = ce?.detail?.text as string | null | undefined
      const isLarge = !!ce?.detail?.isLargeDelay

      if (text && text.trim().length > 0) {
        setScheduleDelta(text.trim())
        setScheduleDeltaIsLarge(isLarge)
      } else {
        // si on envoie texte vide ou null -> on efface
        setScheduleDelta(null)
        setScheduleDeltaIsLarge(false)
      }
    }

    window.addEventListener('lim:schedule-delta', handler as EventListener)
    return () => {
      window.removeEventListener('lim:schedule-delta', handler as EventListener)
    }
  }, [])


    // écoute le mode horaire envoyé par FT
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const enabled = !!ce?.detail?.enabled
      setHourlyMode(enabled)
    }

    window.addEventListener('lim:hourly-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:hourly-mode', handler as EventListener)
    }
  }, [])


  const titleSuffix = trainDisplay ? ` ${trainDisplay}` : ''

  const IconSun = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <circle cx="12" cy="12" r="4" />
      <g strokeWidth="1.5" stroke="currentColor" fill="none">
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4L19 19M5 19l-1.4 1.4M20.4 3.6L19 5" />
      </g>
    </svg>
  )
  const IconMoon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
  const IconFile = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        fill="currentColor"
        fillOpacity=".06"
      />
      <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )

  return (
    <header
      id="lim-titlebar-root"
      className="surface-header rounded-2xl px-3 py-2 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        {/* Gauche — Heure + boutons état */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="tabular-nums text-[18px] leading-none font-semibold tracking-tight">
            {clock}
          </div>
          {/* indicateur d'avance/retard */}
          {scheduleDelta && (
            <span
              className={
                scheduleDeltaIsLarge
                  ? 'text-xs italic text-red-500 dark:text-red-400 leading-none'
                  : 'text-xs italic text-gray-500 dark:text-gray-400 leading-none'
              }
            >
              {scheduleDelta}
            </span>
          )}



          {pdfMode === 'green' && (

            <>
              {/* Auto-scroll */}
              <button
                type="button"
                onClick={() => {
                  const next = !autoScroll
                  setAutoScroll(next)
                  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', { detail: { enabled: next } })
                  )
                }}
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] transition
                  ${
                    autoScroll
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100'
                  }
                `}
                title={
                  autoScroll
                    ? 'Désactiver le défilement automatique'
                    : 'Activer le défilement automatique'
                }
              >
                {autoScroll ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M8 5v14l10-7z" fill="currentColor" />
                  </svg>
                )}
              </button>

              {/* GPS */}
              <button
                type="button"
                onClick={() => {
                  const next = ((gpsState + 1) % 3) as 0 | 1 | 2
                  setGpsState(next)
                }}
                className={`
                  relative h-7 px-3 rounded-full text-xs font-semibold bg-white dark:bg-zinc-900 transition
                  ${gpsState === 0 ? 'border-[3px] border-red-500 text-red-600 dark:text-red-400' : ''}
                  ${gpsState === 1 ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300' : ''}
                  ${gpsState === 2 ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300' : ''}
                `}
              >
                <span className="relative z-10">GPS</span>
                {gpsState === 0 && (
                  <span className="pointer-events-none absolute inset-1 z-20" aria-hidden>
                    <span
                      className="absolute top-1/2 left-1 right-1 h-[2px] bg-red-500/80"
                      style={{ transform: 'rotate(-28deg)', transformOrigin: 'center' }}
                    />
                  </span>
                )}
              </button>

              {/* Mode horaire — indicateur seulement, plus cliquable */}
              <button
                type="button"
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition cursor-default
                  ${
                    hourlyMode
                      ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300'
                      : 'border-[3px] border-red-500 text-red-500 dark:text-red-400'
                  }
                `}
                aria-pressed={hourlyMode}
              >
                <span>🕑</span>
              </button>

            </>
          )}
        </div>

        {/* Centre — Titre */}
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[18px] leading-none font-semibold tracking-tight">
            LIM{titleSuffix}
          </div>
        </div>

        {/* Droite — Contrôles */}
        <div className="flex items-center gap-2">
          {/* Jour/Nuit */}
          <div className="relative inline-flex select-none items-center rounded-xl border p-0.5 text-[11px] shadow-sm border-zinc-200 dark:border-zinc-700">
            <span
              className={`absolute inset-y-0.5 w-1/2 rounded-lg bg-zinc-200/70 dark:bg-zinc-700/80 transition-transform ${
                dark ? 'translate-x-full' : 'translate-x-0'
              }`}
              aria-hidden
            />
            <button
              type="button"
              className={`relative z-10 w-16 rounded-lg px-2.5 py-1 font-medium flex items-center justify-center gap-1 ${
                !dark ? 'text-zinc-900 dark:text-zinc-100' : 'opacity-75'
              }`}
              onClick={() => setDark(false)}
            >
              <IconSun /> Jour
            </button>
            <button
              type="button"
              className={`relative z-10 w-16 rounded-lg px-2.5 py-1 font-medium flex items-center justify-center gap-1 ${
                dark ? 'text-zinc-900 dark:text-zinc-100' : 'opacity-75'
              }`}
              onClick={() => setDark(true)}
            >
              <IconMoon /> Nuit
            </button>
          </div>

          {/* Luminosité */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] opacity-60">Lum:</span>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={brightnessPct}
              onChange={(e) => {
                const raw = Number(e.target.value)
                const clipped = Math.max(50, Math.min(100, raw))
                setBrightness(clipped / 100)
              }}
              className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-zinc-200 outline-none accent-blue-600 dark:bg-zinc-700"
            />
            <span className="w-9 tabular-nums text-[11px] text-right opacity-60">{brightnessPct}%</span>
          </div>

          {/* Importer PDF / modes */}
          <button
            type="button"
            onClick={() => {
              const anyRef = inputRef as any
              const currentInput = anyRef.current as HTMLInputElement | null

              if (currentInput && (currentInput as any).__pdfClickTimer) {
                clearTimeout((currentInput as any).__pdfClickTimer)
                ;(currentInput as any).__pdfClickTimer = null

                if (pdfMode !== 'blue') {
                  setPdfMode('blue')
                }
                return
              }

              if (currentInput) {
                ;(currentInput as any).__pdfClickTimer = setTimeout(() => {
                  ;(currentInput as any).__pdfClickTimer = null

                  if (pdfMode === 'blue') {
                    handleImportClick()
                  } else if (pdfMode === 'green') {
                    setPdfMode('red')
                  } else {
                    setPdfMode('green')
                  }
                }, 200)
              } else {
                if (pdfMode === 'blue') {
                  handleImportClick()
                } else if (pdfMode === 'green') {
                  setPdfMode('red')
                } else {
                  setPdfMode('green')
                }
              }
            }}
            className={
              pdfMode === 'blue'
                ? 'btn btn-primary h-8 px-3 text-xs flex items-center gap-1'
                : pdfMode === 'green'
                  ? 'h-8 px-3 text-xs rounded-md bg-emerald-500 text-white flex items-center gap-1'
                  : 'h-8 px-3 text-xs rounded-md bg-red-500 text-white flex items-center gap-1'
            }
          >
            {pdfMode === 'blue' && <IconFile />}
            {pdfMode === 'blue' && 'Importer PDF'}
            {pdfMode === 'green' && <span className="font-bold">MODE NORMAL</span>}
            {pdfMode === 'red' && <span className="font-bold">MODE SECOURS</span>}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={onPickPdf}
            className="hidden"
          />
        </div>
      </div>

      {/* vidéo keep-awake quasi invisible */}
      <video
        ref={keepAwakeRef}
        src="/keepawake.mp4"
        loop
        playsInline
        style={{
          position: 'fixed',
          bottom: 0,
          right: 0,
          width: '1px',
          height: '1px',
          opacity: 0.01,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
    </header>
  )
}
