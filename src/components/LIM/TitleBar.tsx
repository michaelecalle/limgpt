import { useEffect, useMemo, useRef, useState } from 'react'
import {
  startTestSession,
  stopTestSession,
  exportTestLog,
  logTestEvent,
} from '../../lib/testLogger'

import { initGpsPkEngine, projectGpsToPk } from '../../lib/gpsPkEngine'

import { getOcrOnlineEnabled, setOcrOnlineEnabled } from '../../lib/ocrSettings'
import { uploadPdfToSynology } from '../../lib/synologyUpload'


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
    // ----- TRAITEMENT PDF (spinner + garde-fou timeout) -----
  const [pdfProcessing, setPdfProcessing] = useState(false)
  const pdfProcessingTimerRef = useRef<number | null>(null)

  const PDF_PROCESSING_TIMEOUT_MS = 45_000

  const PDF_PROCESSING_FAIL_MESSAGE =
    "Le traitement du PDF n’a pas abouti. Réessayez ou passez en mode SECOURS (affichage PDF brut)."

  const stopPdfProcessing = () => {
    if (pdfProcessingTimerRef.current != null) {
      window.clearTimeout(pdfProcessingTimerRef.current)
      pdfProcessingTimerRef.current = null
    }
    setPdfProcessing(false)
  }

  const startPdfProcessing = () => {
    // reset propre
    stopPdfProcessing()
    setPdfProcessing(true)

    // garde-fou : si rien ne “termine” le traitement
    pdfProcessingTimerRef.current = window.setTimeout(() => {
      pdfProcessingTimerRef.current = null
      setPdfProcessing(false)
      window.alert(PDF_PROCESSING_FAIL_MESSAGE)
    }, PDF_PROCESSING_TIMEOUT_MS)
  }

  const [testRecording, setTestRecording] = useState(false)

    // ✅ Mode test (ON par défaut pour l’instant) : pilote l’affichage du STOP + l’enregistrement
  const [testModeEnabled, setTestModeEnabled] = useState(true)

    // ✅ Mode simulation (replay) — pilotage global via event sim:enable
  const [simulationEnabled, setSimulationEnabled] = useState(false)

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('sim:enable', { detail: { enabled: simulationEnabled } })
    )
  }, [simulationEnabled])


  // ✅ OCR online (ON par défaut) : persistance localStorage + pilote le routage OCR (ocrRouter)
  const [ocrOnlineEnabled, setOcrOnlineEnabledState] = useState(() =>
    getOcrOnlineEnabled()
  )

  // Sync : tout changement UI -> localStorage (source de vérité pour ocrRouter)
  useEffect(() => {
    setOcrOnlineEnabled(ocrOnlineEnabled)
  }, [ocrOnlineEnabled])


    // ----- UI : spinner pendant traitement PDF (étape 1 : juste l'affichage) -----
  const [pdfLoading, setPdfLoading] = useState(false)

    // ----- GARDE-FOU : timeout si traitement PDF bloqué -----
  const pdfLoadingTimerRef = useRef<number | null>(null)

  const PDF_LOADING_TIMEOUT_MS = 45_000
  const PDF_LOADING_FAIL_MESSAGE =
    "Le traitement du PDF n’a pas abouti (délai dépassé). Réessayez ou passez en mode SECOURS (affichage PDF brut)."

  const stopPdfLoadingGuard = () => {
    if (pdfLoadingTimerRef.current != null) {

      window.clearTimeout(pdfLoadingTimerRef.current)
      pdfLoadingTimerRef.current = null
    }
  }

  const startPdfLoadingGuard = () => {
    stopPdfLoadingGuard()
    pdfLoadingTimerRef.current = window.setTimeout(() => {
      pdfLoadingTimerRef.current = null
      setPdfLoading(false) // on enlève l’overlay
      window.alert(PDF_LOADING_FAIL_MESSAGE) // bouton OK natif
    }, PDF_LOADING_TIMEOUT_MS)
  }



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

  // Texte affiché dans le badge GPS (donné par FT via lim:gps-state)
  const [gpsPkDisplay, setGpsPkDisplay] = useState<string | null>(null)

    // ✅ ref miroir pour lire l'état GPS courant dans d'autres handlers
  const gpsStateRef = useRef<0 | 1 | 2>(0)

  useEffect(() => {
    gpsStateRef.current = gpsState
  }, [gpsState])

  useEffect(() => {
    // 🔊 diffusion globale (comportement existant)
    window.dispatchEvent(
      new CustomEvent('lim:pdf-mode-change', { detail: { mode: pdfMode } })
    )

    // ✅ log rejouable : changement de mode PDF par l'utilisateur
    logTestEvent('ui:pdf:mode-change', {
      mode: pdfMode,
    })
  }, [pdfMode])


  // Diffusion du mode test (pilotage global FT / overlays)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('lim:test-mode', {
        detail: { enabled: testModeEnabled },
      })
    )
  }, [testModeEnabled])


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

  // ✅ Auto-démarrage du test à l'ouverture de l'app (uniquement si mode test ON)
  useEffect(() => {
    if (testAutoStartedRef.current) return
    testAutoStartedRef.current = true

    // si le mode test est OFF, on ne démarre rien
    if (!testModeEnabled) {
      setTestRecording(false)
      return
    }

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

  // calcule un id stable (SHA-256) à partir du contenu du PDF
  const computePdfId = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer()
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashArr = Array.from(new Uint8Array(hashBuf))
    return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  // stocke le PDF localement (Cache Storage) pour le replay
  const storePdfForReplay = async (pdfId: string, file: File): Promise<string> => {
    const cache = await caches.open('limgpt-pdf-replay')
    const key = `/replay/pdf/${pdfId}`
    const req = new Request(key)
    const res = new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/pdf',
        'X-File-Name': file.name,
      },
    })
    await cache.put(req, res)
    return key // clé de récupération
  }

  const onPickPdf: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (file) {
      // ✅ Spinner ON dès que le PDF est sélectionné
      setPdfLoading(true)

      // ✅ Garde-fou : si le parsing ne se termine jamais, on sort du spinner
      startPdfLoadingGuard()

      // 1) ID stable + stockage local replay-ready (on le garde en fallback)
      let pdfId: string | null = null
      let replayKey: string | null = null
      try {
        pdfId = await computePdfId(file)
        replayKey = await storePdfForReplay(pdfId, file)
      } catch (err) {
        console.warn('[TitleBar] Impossible de préparer le PDF pour replay (local)', err)
        pdfId = null
        replayKey = null
      }

      // 2) Upload Synology (QuickConnect) — NE DOIT PAS BLOQUER l'import/parsing
      const synologyCfg = {
        baseUrl: 'https://michaelecalle.quickconnect.to',
        username: 'limgpt_uploader',
        password: 'ME2rdlp66180?',
        destDir: '/LIMGPT_REPLAY/pdfs',
      }

      // Infos upload (connues plus tard)
      let uploadOk: boolean | null = null
      let remotePath: string | null = null
      let uploadError: string | null = null

      // ✅ log rejouable : import PDF (upload async, donc remotePath/uploadOk peuvent être null ici)
      logTestEvent('import:pdf', {
        name: file.name,
        size: file.size,
        type: file.type || null,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : null,
        source: 'file-picker',

        pdfId,

        // fallback local (même iPad)
        replayKey,

        // objectif multi-iPad (upload en tâche de fond)
        storage: 'synology',
        remotePath: null,
        uploadOk: null,
        uploadError: null,
        uploadAsync: true,
      })

      // ✅ IMPORTANT : on déclenche le parsing AVANT tout upload réseau
      window.dispatchEvent(
        new CustomEvent('lim:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'synology', remotePath: null, uploadOk: null },
        })
      )
      window.dispatchEvent(
        new CustomEvent('ft:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'synology', remotePath: null, uploadOk: null },
        })
      )
      window.dispatchEvent(
        new CustomEvent('lim:pdf-raw', {
          detail: { file, pdfId, replayKey, storage: 'synology', remotePath: null, uploadOk: null },
        })
      )

      // L’UI passe en NORMAL dès que l’import est lancé (parsing en cours)
      setPdfMode('green')

      // 3) Upload réseau en arrière-plan + timeout (sans bloquer l'app)
      const UPLOAD_PENDING_TIMEOUT_MS = 12_000

      if (pdfId) {
        let settled = false

        const pendingTimer = window.setTimeout(() => {
          if (settled) return
          // on ne coupe rien, on signale juste que l'upload traîne
          logTestEvent('import:pdf:upload:pending', {
            pdfId,
            timeoutMs: UPLOAD_PENDING_TIMEOUT_MS,
            storage: 'synology',
            source: 'file-picker',
          })
        }, UPLOAD_PENDING_TIMEOUT_MS)

        ;(async () => {
          try {
            const up = await uploadPdfToSynology(synologyCfg, file, pdfId)
            settled = true
            window.clearTimeout(pendingTimer)

            uploadOk = up.ok
            remotePath = up.remotePath ?? null
            uploadError = up.ok ? null : (up.error ?? 'upload_failed')

            // log résultat upload (asynchrone)
            logTestEvent('import:pdf:upload:done', {
              pdfId,
              storage: 'synology',
              uploadOk,
              remotePath,
              uploadError,
              source: 'file-picker',
            })
          } catch (err: any) {
            settled = true
            window.clearTimeout(pendingTimer)

            uploadOk = false
            remotePath = null
            uploadError = err?.message ?? String(err)

            logTestEvent('import:pdf:upload:done', {
              pdfId,
              storage: 'synology',
              uploadOk,
              remotePath,
              uploadError,
              source: 'file-picker',
            })
          }
        })()
      } else {
        // pas de pdfId => pas d'upload synology
        uploadOk = false
        uploadError = 'no_pdfId'
      }
    }

    if (inputRef.current) inputRef.current.value = ''
  }





  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail

      // ✅ Spinner OFF : parsing terminé
            // ✅ On coupe le garde-fou : on a bien reçu la fin de traitement
      stopPdfLoadingGuard()

      setPdfLoading(false)

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

      // ✅ Le Play/Pause affiché doit refléter l'état REEL de FT
      setAutoScroll(enabled)
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

  // ✅ GPS (source de vérité FT) : la TitleBar affiche UNIQUEMENT l'état calculé dans FT
  // Garde-fou #3 : en ORANGE, on conserve le dernier PK GREEN affiché (pas de "danse")
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const state = ce?.detail?.state as 'RED' | 'ORANGE' | 'GREEN' | undefined
      const pk = ce?.detail?.pk as number | null | undefined

      if (state === 'RED') {
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      if (state === 'ORANGE') {
        setGpsState(1)
        // ✅ garde-fou #3 : ne pas effacer le PK affiché en ORANGE
        return
      }

      if (state === 'GREEN') {
        setGpsState(2)
        if (typeof pk === 'number' && Number.isFinite(pk)) {
          setGpsPkDisplay(pk.toFixed(1))
        } else {
          setGpsPkDisplay(null)
        }
      }
    }

    window.addEventListener('lim:gps-state', handler as EventListener)
    return () => {
      window.removeEventListener('lim:gps-state', handler as EventListener)
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
          logTestEvent('gps:position:noPkEngine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const proj = projectGpsToPk(latitude, longitude)
        if (!proj) {
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

        const { pk, s_km, distance_m, nearestIdx, nearestLat, nearestLon } = proj
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

        // log de la position projetée
        logTestEvent('gps:position', {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          distance_m: dist,
          onLine,

          // DEBUG : point ruban retenu par gpsPkEngine (sans impact)
          nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
          nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
          nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
        })

        // 🔊 diffusion globale de la position GPS projetée (pour FT)
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

              // DEBUG : point ruban retenu
              nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
              nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
              nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
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
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent('ui:blocked', {
        control: 'infosLtvFold',
        source: 'titlebar',
      })
      return
    }

    setFolded((prev) => {
      const next = !prev

      // ✅ log rejouable : fold/unfold Infos+LTV
      logTestEvent('ui:infos-ltv:fold-change', {
        folded: next,
        source: 'titlebar',
      })

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

            {pdfLoading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div className="rounded-2xl bg-white dark:bg-zinc-900 px-5 py-4 shadow-lg border border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
            <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div className="text-sm font-semibold">Traitement du PDF…</div>
          </div>
        </div>
      )}

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
                  // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', {
                      control: 'autoScroll',
                      source: 'titlebar',
                    })
                    return
                  }

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

                  // 2) démarrer / arrêter le suivi GPS (désactivé en simulation)
                  if (!simulationEnabled) {
                    if (next) {
                      startGpsWatch()
                    } else {
                      stopGpsWatch()
                    }
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
              className={`relative z-10 w-10 rounded-lg px-2.5 py-1 font-medium flex items-center justify-center ${
                !dark ? 'text-zinc-900 dark:text-zinc-100' : 'opacity-75'
              }`}
              onClick={() => setDark(false)}
              aria-label="Mode jour"
              title="Jour"
            >
              <IconSun />
            </button>
            <button
              type="button"
              className={`relative z-10 w-10 rounded-lg px-2.5 py-1 font-medium flex items-center justify-center ${
                dark ? 'text-zinc-900 dark:text-zinc-100' : 'opacity-75'
              }`}
              onClick={() => setDark(true)}
              aria-label="Mode nuit"
              title="Nuit"
            >
              <IconMoon />
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
              // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
              if (simulationEnabled) {
                logTestEvent('ui:blocked', {
                  control: 'pdfModeButton',
                  source: 'titlebar',
                })
                return
              }

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
            {pdfMode === 'green' && <span className="font-bold">NORMAL</span>}
            {pdfMode === 'red' && <span className="font-bold">SECOURS</span>}
          </button>

          {/* STOP (interruption du test) */}
          {testModeEnabled && (
            <button
              type="button"
onClick={async () => {
                // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', {
                    control: 'stopButton',
                    source: 'titlebar',
                  })
                  return
                }

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

                setPdfLoading(false)
                // 2) Stop session de test (on fige les logs)
                if (testRecording) {
                  // On marque l'intention STOP tout de suite
                  logTestEvent('ui:test:stop', { source: 'stop_button' })

                  // --- Upload automatique du log (avant stopTestSession pour que l'URL soit loggée) ---
                  try {
                    const mod = await import('../../lib/testLogger')
                    const built = mod.buildTestLogFile?.()

                    if (built?.ok && built.blob && built.filename) {
                      const form = new FormData()
                      form.append('token', 'limgpt_upload_v1_9f3a7c2e') // doit matcher upload_log.php
                      // logId = identifiant de session (stable et déjà utilisé)
                      form.append('logId', built.sessionId ?? '')
                      form.append('file', built.blob, built.filename)

                      const res = await fetch(
                        'https://radioequinoxe.com/limgpt/upload_log.php',
                        { method: 'POST', body: form }
                      )

                      const json = await res.json().catch(() => null)

                      if (json?.ok && json?.remoteUrl) {
                        logTestEvent('testlog:uploaded', {
                          remoteUrl: json.remoteUrl,

                          sessionId: built.sessionId ?? null,
                          filename: built.filename,
                          source: 'stop_button',
                        })
                      } else {
                        logTestEvent('testlog:upload:failed', {
                          sessionId: built.sessionId ?? null,
                          reason: json?.error ?? 'bad_response',
                          source: 'stop_button',
                        })
                      }
                    }
                  } catch (err: any) {
                    logTestEvent('testlog:upload:failed', {
                      reason: err?.message ?? String(err),
                      source: 'stop_button',
                    })
                  }

                  // Maintenant seulement : on fige la session
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
          )}
          {/* Paramètres */}
          <details className="relative">
            <summary
              className="list-none h-8 w-10 rounded-md bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-pointer select-none"
              title="Paramètres"
              aria-label="Paramètres"
            >
              {/* icône roue dentée */}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z"
                  fill="currentColor"
                  opacity="0.18"
                />
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </summary>

            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-3 text-xs z-[9999]">
              <div className="text-[11px] font-semibold opacity-70 mb-2">
                Paramètres (provisoire)
              </div>

              {/* Toggle MODE TEST (branché) */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span className="font-semibold">Mode test</span>
                <input
                  type="checkbox"
                  checked={testModeEnabled}
                  onChange={() => {
                    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', {
                        control: 'testModeToggle',
                        source: 'settings',
                      })
                      return
                    }

                    // OFF -> équivalent STOP (proposition export) puis désactivation du mode test
                    if (testModeEnabled) {
                      const wantDisable = window.confirm(
                        'Désactiver le mode test ?\n\n(équivaut à STOP : proposition d’exporter les logs)'
                      )
                      if (!wantDisable) return

                      // 1) Décharger le PDF + retour état initial UI
                      if (autoScroll) {
                        setAutoScroll(false)
                        window.dispatchEvent(
                          new CustomEvent('ft:auto-scroll-change', {
                            detail: { enabled: false, source: 'titlebar' },
                          })
                        )
                      }
                      stopGpsWatch()

                      setScheduleDelta(null)
                      setScheduleDeltaIsLarge(false)

                      setPdfMode('blue')
                      setPdfLoading(false)
                      stopPdfLoadingGuard()

                      window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                      window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                      window.dispatchEvent(
                        new CustomEvent('lim:pdf-raw', { detail: { file: null } })
                      )

                      // 2) Stop session de test (on fige les logs)
                      if (testRecording) {
                        logTestEvent('ui:test:stop', { source: 'settings_toggle' })
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

                      // 4) Désactivation du mode test (=> le bouton STOP disparaît)
                      setTestModeEnabled(false)
                      return
                    }

                    // ON -> démarrage d’un nouvel enregistrement
                    const wantEnable = window.confirm(
                      'Activer le mode test ?\n\n(démarre un nouvel enregistrement)'
                    )
                    if (!wantEnable) return

                    setTestModeEnabled(true)

                    const nextMode: 'blue' = 'blue'
                    const labelParts: string[] = []
                    if (trainDisplay) labelParts.push(`train_${trainDisplay}`)
                    labelParts.push(`mode_${nextMode}`)
                    labelParts.push('manual')

                    const label = labelParts.join('_')
                    startTestSession(label)
                    logTestEvent('ui:test:manual-start', {
                      source: 'settings_toggle',
                      train: trainDisplay ?? null,
                      pdfMode: nextMode,
                      label,
                    })
                    setTestRecording(true)
                  }}

                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />




              {/* Toggle OCR (branché) */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span>OCR online</span>
                <input
                  type="checkbox"
                  checked={ocrOnlineEnabled}
                  onChange={() => {
                    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', {
                        control: 'ocrOnlineToggle',
                        source: 'settings',
                      })
                      return
                    }

                    const next = !ocrOnlineEnabled

                    // 1) UI/state
                    setOcrOnlineEnabledState(next)

                    // 2) log rejouable (simulation)
                    logTestEvent('settings:ocrOnline:set', {
                      enabled: next,
                      source: 'settings',
                    })
                  }}

                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>



            </div>
          </details>



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
