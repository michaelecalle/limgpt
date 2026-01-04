import { useEffect, useMemo, useRef, useState } from 'react'
import {
  startTestSession,
  stopTestSession,
  exportTestLog,
  logTestEvent,
} from '../../lib/testLogger'

import { initGpsPkEngine, projectGpsToPk } from '../../lib/gpsPkEngine'

type LIMFields = {
  tren?: string
  trenPadded?: string
  type?: string
  composicion?: string
  unit?: string
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
  const [referenceMode, setReferenceMode] = useState<'HORAIRE' | 'GPS'>(
    'HORAIRE'
  )
  const [standbyMode, setStandbyMode] = useState(false)
  const [pdfMode, setPdfMode] = useState<'blue' | 'green' | 'red'>('blue')
  const [testRecording, setTestRecording] = useState(false)

  // ✅ Auto-start du test : garde-fou pour ne le lancer qu'une fois
  const testAutoStartedRef = useRef(false)

  // avance/retard affiché à côté de l'heure (ex: "+3 min" ou "-1 min")
  const [scheduleDelta, setScheduleDelta] = useState<string | null>(null)
  const [scheduleDeltaIsLarge, setScheduleDeltaIsLarge] = useState(false)

  // ----- GPS / PK (moteur labo) -----
  const [gpsPkReady, setGpsPkReady] = useState(false)
  const gpsWatchIdRef = useRef<number | null>(null)

  const gpsLastInfoRef = useRef<{
    lat: number
    lon: number
    accuracy?: number
    pk?: number | null
    s_km?: number | null
    dist_m?: number | null
  } | null>(null)

  // Seuils de "fraîcheur" du GPS (utilisés dans les étapes suivantes)
  const GPS_FRESH_TIMEOUT_MS = 30_000 // > 30 s sans nouvelle position → GPS considéré "pas frais"
  const GPS_FROZEN_SKM_EPS = 0.005 // variation minimale de s_km pour considérer qu'on progresse

  // Mémoire de la dernière mise à jour GPS (pour détecter une position figée)
  const lastGpsUpdateRef = useRef<number | null>(null)
  const lastGpsSkmRef = useRef<number | null>(null)

  // Texte affiché dans le badge GPS quand on est calé sur la ligne (PK estimé)
  const [gpsPkDisplay, setGpsPkDisplay] = useState<string | null>(null)

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('lim:pdf-mode-change', { detail: { mode: pdfMode } })
    )
  }, [pdfMode])

  // Diffusion du mode test (pilotage global FT / overlays)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('lim:test-mode', {
        detail: { enabled: testRecording },
      })
    )
  }, [testRecording])

  // ✅ Auto-démarrage du test à l'ouverture de l'app
  useEffect(() => {
    if (testAutoStartedRef.current) return
    testAutoStartedRef.current = true

    // label simple à l'ouverture (train inconnu au boot, pdfMode = blue)
    const bootMode: 'blue' = 'blue'

    const labelParts: string[] = []
    if (trainDisplay) labelParts.push(`train_${trainDisplay}`)
    labelParts.push(`mode_${bootMode}`)
    labelParts.push('auto')

    const label = labelParts.join('_')

    startTestSession(label)
    logTestEvent('ui:test:auto-start', {
      train: trainDisplay ?? null,
      pdfMode: bootMode,
      label,
    })
    setTestRecording(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Initialisation du moteur GPS→PK -----
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await initGpsPkEngine()
        if (!cancelled) {
          setGpsPkReady(true)
          console.log('[TitleBar] gpsPkEngine prêt')
        }
      } catch (err) {
        console.error('[TitleBar] Erreur init gpsPkEngine', err)
        if (!cancelled) {
          setGpsPkReady(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

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
    window.dispatchEvent(
      new CustomEvent('lim:brightness-change', { detail: { brightness } })
    )
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
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  // ----- NUMÉRO DE TRAIN + TYPE + COMPOSITION -----
  const [trainDisplay, setTrainDisplay] = useState<string | undefined>(() => {
    const w = window as any
    const last: LIMFields | undefined = w.__limLastParsed
    const raw = last?.trenPadded ?? last?.tren
    return toTitleNumber(raw)
  })

  const [trainType, setTrainType] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawType = last?.type
    return rawType ? String(rawType) : undefined
  })

  const [trainComposition, setTrainComposition] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawComp = last?.composicion ?? last?.unit
    return rawComp ? String(rawComp) : undefined
  })

  const [folded, setFolded] = useState(false)

  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail

      // mise à jour du numéro de train
      const raw = detail.trenPadded ?? detail.tren
      const disp = toTitleNumber(raw)
      setTrainDisplay(disp)

      // mise à jour du type (ex: T200)
      const rawType = (detail as any).type
      setTrainType(rawType ? String(rawType) : undefined)

      // mise à jour de la composition (ex: US)
      const rawComp = (detail as any).composicion ?? (detail as any).unit
      setTrainComposition(rawComp ? String(rawComp) : undefined)
    }

    const onTrain = (e: Event) => {
      const ce = e as CustomEvent
      const val = (ce.detail as any)?.train as string | undefined
      const disp = toTitleNumber(val)
      if (disp) setTrainDisplay(disp)
      // lim:train ne transporte pas forcément type/composition → on ne les touche pas ici
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
      const rawText = ce?.detail?.text as string | null | undefined
      const isLarge = !!ce?.detail?.isLargeDelay

      const text =
        rawText && rawText.trim().length > 0 ? rawText.trim() : null

      // log labo : ce que la TitleBar reçoit et ce qu'elle va afficher
      logTestEvent('ui:schedule-delta', {
        text,
        isLarge,
      })

      if (text) {
        setScheduleDelta(text)
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
      const standby = !!ce?.detail?.standby

      // hourlyMode = "mode horaire actif" (lecture sur la FT)
      // - autoScroll = true  => lecture en cours (vert)
      // - autoScroll = false & hourlyMode = true => standby (orange)
      // - autoScroll = false & hourlyMode = false => mode horaire OFF (rouge)
      setHourlyMode(enabled || standby)
      setStandbyMode(standby)
    }

    window.addEventListener('lim:hourly-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:hourly-mode', handler as EventListener)
    }
  }, [])

  // écoute le mode de référence (HORAIRE / GPS) envoyé par FT
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce?.detail?.mode as 'HORAIRE' | 'GPS' | undefined

      if (mode === 'HORAIRE' || mode === 'GPS') {
        setReferenceMode(mode)
      }
    }

    window.addEventListener('lim:reference-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:reference-mode', handler as EventListener)
    }
  }, [])

  // synchronise le bouton Play/Pause + état horaire/standby si FT change le mode auto-scroll
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as any
      const enabled = !!detail.enabled
      const standby = !!detail.standby

      // 1) on met à jour l'état du bouton Play/Pause
      setAutoScroll(enabled)

      // 2) si FT fournit un "standby" explicite (cas Standby auto),
      //    on aligne aussi hourlyMode / standbyMode pour la TitleBar
      if ('standby' in detail) {
        setHourlyMode(enabled || standby)
        setStandbyMode(standby)
      }
    }

    window.addEventListener('ft:auto-scroll-change', handler as EventListener)
    return () => {
      window.removeEventListener('ft:auto-scroll-change', handler as EventListener)
    }
  }, [])

  // écoute directe des événements gps:position pour mettre à jour l'icône GPS + PK affiché
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>
      const detail = ce.detail || {}

      const hasFix =
        typeof (detail as any).lat === 'number' &&
        typeof (detail as any).lon === 'number'
      const onLine = !!(detail as any).onLine
      const pkRaw = (detail as any).pk as number | string | null | undefined

      // pas de fix GPS → état 0 (rouge) + on efface le texte PK
      if (!hasFix) {
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      // 💾 mémorisation d'une position GPS "valide" (pour la fraîcheur)
      const ts =
        typeof (detail as any).timestamp === 'number'
          ? (detail as any).timestamp
          : Date.now()
      lastGpsUpdateRef.current = ts

      const sKmRaw = (detail as any).s_km as number | string | null | undefined
      if (sKmRaw != null) {
        const sVal = typeof sKmRaw === 'number' ? sKmRaw : Number(sKmRaw)
        if (Number.isFinite(sVal)) {
          lastGpsSkmRef.current = sVal
        }
      }

      // fix présent : vert si calé sur la ligne, orange sinon
      setGpsState(onLine ? 2 : 1)

      // si position calée sur la ligne + PK dispo → on l'affiche
      if (onLine && pkRaw != null) {
        const pkNum = typeof pkRaw === 'number' ? pkRaw : Number(pkRaw)
        if (Number.isFinite(pkNum)) {
          setGpsPkDisplay(pkNum.toFixed(1)) // ex: 621.123
          return
        }
      }

      // hors ligne ou PK invalide → pas d'affichage numérique
      setGpsPkDisplay(null)
    }

    window.addEventListener('gps:position', handler as EventListener)
    return () => {
      window.removeEventListener('gps:position', handler as EventListener)
    }
  }, [])

   // Surcouche : GPS vert uniquement si la position est « fraîche »
  // ⚠️ Important : on évite le "rouge" sur simple stale, sinon ça contredit FT.
  // Rouge = pas de fix. Stale = ORANGE.
  useEffect(() => {
    // Variables fermées sur l'effet : pas de nouveau hook
    let lastFixTs: number | null = null
    let lastHasFix = false
    let lastOnLine = false

    // Alignement plus proche de FT : FT considère stale très vite (8s).
    const GPS_FRESH_TIMEOUT_MS = 8_000
    // Au-delà, on considère "très vieux" mais on reste ORANGE tant qu'il y a eu un fix.
    const GPS_STALE_TIMEOUT_MS = 60_000

    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>
      const detail = ce.detail || {}

      const hasFix =
        typeof (detail as any).lat === 'number' &&
        typeof (detail as any).lon === 'number'
      const onLine = !!(detail as any).onLine

      const ts =
        typeof (detail as any).timestamp === 'number'
          ? (detail as any).timestamp
          : Date.now()

      if (!hasFix) {
        // Pas de fix → on note juste l'absence de signal
        lastHasFix = false
        lastOnLine = false
        lastFixTs = null
        return
      }

      lastHasFix = true
      lastOnLine = onLine
      lastFixTs = ts
    }

    window.addEventListener('gps:position', handler as EventListener)

    const intervalId = window.setInterval(() => {
      if (!lastHasFix || !lastFixTs) {
        // Aucun fix récent connu → rouge + on efface le PK
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      const age = Date.now() - lastFixTs

      if (age <= GPS_FRESH_TIMEOUT_MS && lastOnLine) {
        // Fix récent et calé sur la ligne → vert
        setGpsState(2)
        // (on ne touche pas au PK ici : le handler gps:position principal le gère)
      } else if (age <= GPS_STALE_TIMEOUT_MS) {
        // Fix présent mais pas assez frais / pas calé → orange
        setGpsState(1)
        // Optionnel : on masque le PK quand ce n'est pas vert (évite un PK "trompeur")
        setGpsPkDisplay(null)
      } else {
        // Très vieux MAIS on a déjà eu un fix : on reste ORANGE (pas rouge),
        // sinon en conduite tu crois être en "GPS RED" alors que FT peut être ORANGE.
        setGpsState(1)
        setGpsPkDisplay(null)
      }
    }, 1000)

    return () => {
      window.removeEventListener('gps:position', handler as EventListener)
      window.clearInterval(intervalId)
    }
  }, [])


  // ----- GPS : démarrage / arrêt du watchPosition -----
  useEffect(() => {
    // au démontage de la TitleBar, on coupe le GPS si besoin
    return () => {
      stopGpsWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startGpsWatch() {
    if (gpsWatchIdRef.current != null) {
      // déjà en cours
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[TitleBar] Geolocation non disponible')
      setGpsState(0)
      // log échec démarrage GPS
      logTestEvent('gps:watch:start:failed', { reason: 'no_geolocation' })
      return
    }

    console.log('[TitleBar] Démarrage watchPosition GPS...')
    logTestEvent('gps:watch:start', {})

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords

        // mémorisation brute pour debug
        gpsLastInfoRef.current = {
          lat: latitude,
          lon: longitude,
          accuracy,
        }

        if (!gpsPkReady) {
          // GPS OK mais moteur PK pas prêt
          setGpsState(1)
          logTestEvent('gps:position:noPkEngine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const proj = projectGpsToPk(latitude, longitude)
        if (!proj) {
          setGpsState(1)
          console.log(
            `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(
              6
            )} → hors ruban (proj=null)`
          )
          logTestEvent('gps:position:offLine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const { pk, s_km, distance_m } = proj
        const dist = distance_m ?? null
        const onLine = dist != null && dist <= 200

        gpsLastInfoRef.current = {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          dist_m: dist,
        }

        setGpsState(onLine ? 2 : 1)

        // log de la position projetée
        logTestEvent('gps:position', {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          distance_m: dist,
          onLine,
        })

        // 🔊 diffusion globale de la position GPS projetée
        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat: latitude,
              lon: longitude,
              accuracy,
              pk: pk ?? null,
              s_km: s_km ?? null,
              distance_m: dist,
              onLine,
              timestamp: Date.now(),
            },
          })
        )

        console.log(
          `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(
            6
          )} → PK≈${pk?.toFixed?.(3)}  s≈${s_km?.toFixed?.(
            3
          )} km  dist=${dist?.toFixed?.(1)} m  onLine=${onLine}`
        )
      },
      (err) => {
        console.error('[TitleBar] Erreur GPS', err)
        setGpsState(0)

        logTestEvent('gps:watch:error', {
          code: (err as any)?.code ?? null,
          message: (err as any)?.message ?? String(err),
        })
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    gpsWatchIdRef.current = id
    // on part du principe : signal présent mais pas encore forcément « calé »
    setGpsState(1)
  }

  function stopGpsWatch() {
    const id = gpsWatchIdRef.current

    if (id != null) {
      logTestEvent('gps:watch:stop', {})
    }

    if (id != null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(id)
    }
    gpsWatchIdRef.current = null
    gpsLastInfoRef.current = null
    setGpsState(0)
    setGpsPkDisplay(null)
    console.log('[TitleBar] Arrêt watchPosition GPS')
  }

  const titleSuffix = trainDisplay ? ` ${trainDisplay}` : ''
  const baseTitle = `LIM${titleSuffix}`

  const extendedParts: string[] = []
  if (trainType && String(trainType).trim().length > 0) {
    extendedParts.push(String(trainType).trim())
  }
  if (trainComposition && String(trainComposition).trim().length > 0) {
    extendedParts.push(String(trainComposition).trim())
  }

  const fullTitle =
    folded && extendedParts.length > 0
      ? `${baseTitle} - ${extendedParts.join(' - ')}`
      : baseTitle

  const handleTitleClick = () => {
    setFolded((prev) => {
      const next = !prev
      window.dispatchEvent(
        new CustomEvent('lim:infos-ltv-fold-change', {
          detail: { folded: next },
        })
      )
      return next
    })
  }

  const IconSun = () => (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className="opacity-80"
    >
      <circle cx="12" cy="12" r="4" />
      <g strokeWidth="1.5" stroke="currentColor" fill="none">
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4L19 19M5 19l-1.4 1.4M20.4 3.6L19 5" />
      </g>
    </svg>
  )
  const IconMoon = () => (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className="opacity-80"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
  const IconFile = () => (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className="opacity-80"
    >
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

                  // log du clic Play/Pause
                  logTestEvent('ui:autoScroll:toggle', {
                    enabled: next,
                    source: 'titlebar',
                  })

                  // 1) comportement existant : informer FT du changement d’auto-scroll
                  setAutoScroll(next)
                  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: next, source: 'titlebar' },
                    })
                  )

                  // 2) démarrer / arrêter le suivi GPS
                  if (next) {
                    // passage en mode "lecture" → on démarre le watchPosition
                    startGpsWatch()
                  } else {
                    // pause / arrêt → on coupe le GPS
                    stopGpsWatch()
                  }
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
                // indicateur uniquement : plus de changement d'état manuel
                className={`
                  relative h-7 px-3 rounded-full text-xs font-semibold bg-white dark:bg-zinc-900 transition cursor-default
                  ${
                    gpsState === 0
                      ? 'border-[3px] border-red-500 text-red-600 dark:text-red-400'
                      : ''
                  }
                  ${
                    gpsState === 1
                      ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300'
                      : ''
                  }
                  ${
                    gpsState === 2
                      ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300'
                      : ''
                  }
                `}
                title={
                  gpsState === 0
                    ? 'GPS indisponible / non calé'
                    : gpsState === 1
                      ? 'GPS présent mais hors ligne de référence'
                      : 'GPS OK : position calée sur la ligne'
                }
              >
                <span className="relative z-10 tabular-nums">
                  {gpsState === 2 && gpsPkDisplay ? `PK ${gpsPkDisplay}` : 'GPS'}
                </span>
                {gpsState === 0 && (
                  <span
                    className="pointer-events-none absolute inset-1 z-20"
                    aria-hidden
                  >
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
                    referenceMode === 'GPS'
                      ? 'border-[3px] border-zinc-400 text-zinc-500 dark:border-zinc-500 dark:text-zinc-300'
                      : standbyMode
                        ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300'
                        : autoScroll
                          ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300'
                          : 'border-[3px] border-red-500 text-red-500 dark:text-red-400'
                  }
                `}
                aria-pressed={referenceMode === 'HORAIRE' && hourlyMode}
              >
                <span>🕑</span>
              </button>
            </>
          )}
        </div>

        {/* Centre — Titre */}
        <div className="min-w-0 flex-1 text-center">
          <button
            type="button"
            onClick={handleTitleClick}
            className="max-w-full truncate text-[18px] leading-none font-semibold tracking-tight bg-transparent border-0 cursor-pointer"
            title={
              folded
                ? 'Afficher les blocs INFOS et LTV'
                : 'Afficher uniquement la zone FT'
            }
          >
            {fullTitle}
          </button>
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
            <span className="w-9 tabular-nums text-[11px] text-right opacity-60">
              {brightnessPct}%
            </span>
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

          {/* STOP (interruption du test) */}
          <button
            type="button"
            onClick={() => {
              // 1) Décharger le PDF + retour état initial UI
              // - stop auto-scroll + stop GPS
              if (autoScroll) {
                setAutoScroll(false)
                window.dispatchEvent(
                  new CustomEvent('ft:auto-scroll-change', {
                    detail: { enabled: false, source: 'titlebar' },
                  })
                )
              }
              stopGpsWatch()

              // - reset affichage avance/retard
              setScheduleDelta(null)
              setScheduleDeltaIsLarge(false)

              // - retour à l'état initial PDF
              setPdfMode('blue')

              // 🔊 événements de "déchargement" (à écouter côté PDF/FT si besoin)
              window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
              window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
              window.dispatchEvent(
                new CustomEvent('lim:pdf-raw', { detail: { file: null } })
              )

              // 2) Stop session de test (on fige les logs)
              if (testRecording) {
                logTestEvent('ui:test:stop', { source: 'stop_button' })
                stopTestSession()
                setTestRecording(false)
              }

              // 3) Proposition export
              const wantExport = window.confirm('Exporter les logs, oui ou non ?')

              if (wantExport) {
                const exported = exportTestLog()
                if (!exported) {
                  alert('Aucun événement de test à exporter.')
                }
              }

              // 4) ✅ Redémarrer immédiatement une nouvelle session de log
              //    (label forcé en mode_blue, car setPdfMode est asynchrone)
              const nextMode: 'blue' = 'blue'

              const labelParts: string[] = []
              if (trainDisplay) labelParts.push(`train_${trainDisplay}`)
              labelParts.push(`mode_${nextMode}`)
              labelParts.push('auto')

              const label = labelParts.join('_')
              startTestSession(label)
              setTestRecording(true)

              // (Si Non : rien à faire, on est déjà revenu à l'état initial)
            }}
            disabled={!testRecording}
            className={
              testRecording
                ? 'h-8 w-10 rounded-md bg-red-500 text-white font-semibold flex items-center justify-center'
                : 'h-8 w-10 rounded-md bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 flex items-center justify-center cursor-not-allowed'
            }
            title="Stop (interrompre le test)"
            aria-label="Stop"
          >
            {/* icône panneau STOP */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M8.2 2.6h7.6l5.6 5.6v7.6l-5.6 5.6H8.2L2.6 15.8V8.2L8.2 2.6Z"
                fill="currentColor"
                opacity="0.18"
              />
              <path
                d="M8.2 2.6h7.6l5.6 5.6v7.6l-5.6 5.6H8.2L2.6 15.8V8.2L8.2 2.6Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <text
                x="12"
                y="14"
                textAnchor="middle"
                fontSize="7"
                fontWeight="700"
                fill="currentColor"
                style={{ letterSpacing: '0.5px' }}
              >
                STOP
              </text>
            </svg>
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
    </header>
  )
}
