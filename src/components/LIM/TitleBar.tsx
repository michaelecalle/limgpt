import { useEffect, useMemo, useRef, useState } from 'react'
import {
  startTestSession,
  stopTestSession,
  exportTestLogLocal,
  logTestEvent,
} from '../../lib/testLogger'

import {
  initGpsPkEngine,
  projectGpsToPk,
  resetGpsPkEngineMemory,
  setExpectedDirectionForReplay,
} from '../../lib/gpsPkEngine'
import { RIBBON_POINTS } from '../../lib/ligne050_ribbon_dense'

import { getOcrOnlineEnabled, setOcrOnlineEnabled } from '../../lib/ocrSettings'

import { APP_VERSION } from '../version'

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

  // ----- FT VIEW MODE (ES / FR / AUTO) -----
  // Option A : pas de persistance (ce n’est pas une préférence, c’est un état de travail)
  // Par défaut : ADIF (ES)
  const [ftViewMode, setFtViewMode] = useState<'AUTO' | 'ES' | 'FR'>('ES')
  // ✅ Indique que le mode AUTO est engagé (même après bascule vers ES/FR)
  const [autoEngaged, setAutoEngaged] = useState(false)
  // ✅ Verrou : après le 1er clic AUTO, on ne refait plus de "sélection auto" (hors Figueres)
  const autoLockedRef = useRef(false)
  const autoInitialTargetRef = useRef<'ES' | 'FR' | null>(null)

useEffect(() => {
  window.dispatchEvent(
    new CustomEvent('ft:view-mode-change', { detail: { mode: ftViewMode } })
  )
}, [ftViewMode])

// ⬇️ AJOUT ICI
useEffect(() => {
  if (ftViewMode === 'FR') {
    setFolded(false)

    window.dispatchEvent(
      new CustomEvent('lim:infos-ltv-fold-change', {
        detail: { folded: false },
      })
    )

    logTestEvent('ui:infos-ltv:auto-unfold', {
      reason: 'ftViewMode_FR',
      source: 'titlebar',
    })
  }
}, [ftViewMode])




  // =========================
  // AUTO resolve (pré-calage GPS post-parsing)
  // - Calculé après lim:parsed (GPS ponctuel)
  // - Ne déclenche AUCUN switch automatique ici (ça viendra au clic AUTO, étape 2)
  // =========================
  const AUTO_FR_SKM_THRESHOLD = 136.442302
  // =========================
  // Zone Figueres (à calibrer)
  // - On utilisera s_km / nearestIdx (ruban) plutôt que PK
  // - Les bornes seront renseignées après un test terrain/log (sans guess)
  // =========================
  // ✅ Zone Figueres (valeur mesurée) : centre ≈ 133.114904, largeur mini ±0.4 km
  // -> borne "par défaut" pour que la feature marche tout de suite en replay
  const FIGUERES_ZONE = {
    sKmMin: 132.714904 as number | null, // 133.114904 - 0.400
    sKmMax: 133.514904 as number | null, // 133.114904 + 0.400

    // Tolérance de stabilité (si ruban densifié ~25m, 10 = ~250m)
    stableIdxTolerance: 10,
  }


  // ✅ Source de vérité runtime pour la zone (modifiable par calibration)
  const figueresZoneMinRef = useRef<number | null>(null)
  const figueresZoneMaxRef = useRef<number | null>(null)

  // ✅ “Latch” Figueres :
  // - On arme Figueres uniquement si on a eu GPS GREEN dans la zone.
  // - Ensuite, on tolère ORANGE pendant l’arrêt sans désarmer immédiatement.
  const figueresArmedRef = useRef(false)
  const figueresArmedAtRef = useRef<number | null>(null)

  // Durée pendant laquelle on considère “Figueres armé” après un GREEN en zone
  // (large volontairement pour couvrir approche + arrêt + aléas)
  const FIGUERES_ARM_TTL_MS = 10 * 60 * 1000 // 10 minutes

  const isFigueresArmed = () => {
    if (!figueresArmedRef.current) return false
    const t0 = figueresArmedAtRef.current
    if (typeof t0 !== 'number' || !Number.isFinite(t0)) return false

    // ✅ “now” cohérent : si on a un timestamp de fix (replay), on l’utilise
    const nowMs =
      (typeof lastGpsFixRef.current?.ts === 'number' && Number.isFinite(lastGpsFixRef.current.ts))
        ? lastGpsFixRef.current.ts
        : Date.now()

    return nowMs - t0 <= FIGUERES_ARM_TTL_MS
  }

  // ✅ Zone minimale : 400 m de chaque côté (±0.400 km)
  const FIGUERES_MIN_HALF_WIDTH_KM = 0.4
  // ✅ Ancre Figueres (mesurée dans ton log)
// Sert de fallback si la zone n'est pas calibrée
const FIGUERES_SKM_ANCHOR = 133.114904
const FIGUERES_ANCHOR_TOL_KM = 1.0 // tolérance large, juste pour éviter les faux positifs


  const isInFigueresZone = (fix: {
    nearestIdx: number | null
    s_km: number | null
  } | null): boolean => {
    if (!fix) return false
    const { s_km } = fix
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return false

    // ✅ priorité aux refs (calibration), fallback sur la config
    const a = figueresZoneMinRef.current ?? FIGUERES_ZONE.sKmMin
    const b = figueresZoneMaxRef.current ?? FIGUERES_ZONE.sKmMax

// ✅ Si rien n'est calibré => fallback sur l'ancre Figueres (±0.4 km)
// (et on ajoute une garde : on ne considère la zone que si on est proche de l'ancre)
if (a == null && b == null) {
  const min = FIGUERES_SKM_ANCHOR - FIGUERES_MIN_HALF_WIDTH_KM
  const max = FIGUERES_SKM_ANCHOR + FIGUERES_MIN_HALF_WIDTH_KM

  // garde supplémentaire : si on est totalement loin de l'ancre, on évite un "inZone" absurde
  if (Math.abs(s_km - FIGUERES_SKM_ANCHOR) > FIGUERES_ANCHOR_TOL_KM) return false

  return s_km >= min && s_km <= max
}


    // Si une seule borne est connue : on prend cette valeur comme "centre"
    const rawMin = a != null ? a : (b as number)
    const rawMax = b != null ? b : (a as number)

    const min0 = Math.min(rawMin, rawMax)
    const max0 = Math.max(rawMin, rawMax)

    // ✅ On garantit AU MOINS ±0.400 km autour du centre.
    const center = (min0 + max0) / 2
    const half0 = (max0 - min0) / 2
    const half = Math.max(half0, FIGUERES_MIN_HALF_WIDTH_KM)

    const min = center - half
    const max = center + half

    return s_km >= min && s_km <= max
  }

  // ✅ Calibration Figueres (debug)
  // Déclencheurs :
  // - touche F8 (sans modificateurs)
  // - event manuel : window.dispatchEvent(new Event('figueres:calib-request'))
  useEffect(() => {
    const doCalib = () => {
      const fix = lastGpsFixRef.current
      const gpsStateNow = gpsStateRef.current

      const payload = {
        source: 'figueres:calibration',
        tLocal: Date.now(),
        gpsState: gpsStateNow, // 0/1/2
        tsFix: fix?.ts ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
        s_km: fix?.s_km ?? null,
        onLine: fix?.onLine ?? null,
        zoneMin: figueresZoneMinRef.current,
        zoneMax: figueresZoneMaxRef.current,
        inZone: isInFigueresZone(fix),
      }

      console.log('[Figueres][CALIB]', payload)
      logTestEvent('figueres:calib', payload)

      window.alert(
        `Figueres CALIB\n` +
          `gpsState=${gpsStateNow}\n` +
          `s_km=${payload.s_km ?? 'null'}\n` +
          `idx=${payload.nearestIdx ?? 'null'}\n` +
          `zone=[${payload.zoneMin ?? 'null'} .. ${payload.zoneMax ?? 'null'}]\n` +
          `inZone=${payload.inZone ? 'YES' : 'NO'}`
      )
    }

    const setMin = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MIN: s_km indisponible')
        return
      }
      figueresZoneMinRef.current = s
      console.log('[Figueres][CALIB] SET MIN', { s_km: s })
      logTestEvent('figueres:calib:set-min', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MIN OK\ns_km=${s}`)
    }

    const setMax = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MAX: s_km indisponible')
        return
      }
      figueresZoneMaxRef.current = s
      console.log('[Figueres][CALIB] SET MAX', { s_km: s })
      logTestEvent('figueres:calib:set-max', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MAX OK\ns_km=${s}`)
    }

    const dumpZone = () => {
      const a = figueresZoneMinRef.current
      const b = figueresZoneMaxRef.current

      console.log('[Figueres][CALIB] ZONE', {
        sKmMin: a,
        sKmMax: b,
        ready:
          typeof a === 'number' &&
          Number.isFinite(a) &&
          typeof b === 'number' &&
          Number.isFinite(b),
      })

      if (
        typeof a === 'number' &&
        Number.isFinite(a) &&
        typeof b === 'number' &&
        Number.isFinite(b)
      ) {
        const min = Math.min(a, b)
        const max = Math.max(a, b)
        window.alert(`Figueres ZONE\nsKmMin=${min}\nsKmMax=${max}`)
      } else {
        window.alert('Figueres ZONE: min/max incomplets')
      }
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'F8') {
        ev.preventDefault()
        doCalib()
        return
      }
      if (ev.key === 'F9') {
        ev.preventDefault()
        setMin()
        return
      }
      if (ev.key === 'F6') {
        ev.preventDefault()
        setMax()
        return
      }
      if (ev.key === 'F7') {
        ev.preventDefault()
        dumpZone()
        return
      }
    }

    const onRequest = () => doCalib()

    window.addEventListener('keydown', onKeyDown, { capture: true } as any)
    window.addEventListener('figueres:calib-request', onRequest as EventListener)

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
      window.removeEventListener('figueres:calib-request', onRequest as EventListener)
    }
  }, [])




  type AutoResolvedSide = 'ES' | 'FR' | null

  const [autoResolved, setAutoResolved] = useState<{
    
    available: boolean
    side: AutoResolvedSide
    s_km: number | null
    pk: number | null
    ts: number | null
    reason:
      | 'ok'
      | 'no_geolocation'
      | 'permission_denied'
      | 'timeout'
      | 'proj_null'
      | 'no_s_km'
      | 'engine_not_ready'
      | 'error'
      | null
  }>(() => ({
    available: false,
    side: null,
    s_km: null,
    pk: null,
    ts: null,
    reason: null,
  }))
  // ✅ Timer de latence ergonomique pour le switch AUTO (annulable)
  const autoSwitchTimerRef = useRef<number | null>(null)

  const resolveSideFromSkm = (s_km: number | null): AutoResolvedSide => {
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return null
    return s_km < AUTO_FR_SKM_THRESHOLD ? 'ES' : 'FR'
  }

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

  // ✅ delta précis (en secondes) si FT le fournit
  const [scheduleDeltaSec, setScheduleDeltaSec] = useState<number | null>(null)

  // =========================
  // GPS Replay (offline) — projection pure
  // =========================
  const gpsReplayInputRef = useRef<HTMLInputElement>(null)
  const [gpsReplayBusy, setGpsReplayBusy] = useState(false)

  // ✅ Progression (0..1) pour afficher une barre sur le bouton pendant le replay
  const [gpsReplayProgress, setGpsReplayProgress] = useState(0)

  const downloadTextFile = (
    filename: string,
    content: string,
    mime = 'text/plain'
  ) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)

    try {
      a.click()
    } finally {
      a.remove()
      // ✅ Important : ne pas révoquer tout de suite (sinon NotFoundError possible)
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {}
      }, 1500)
    }
  }

  const buildRibbonKml = () => {
    const esc = (s: any) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    if (!Array.isArray(RIBBON_POINTS) || RIBBON_POINTS.length === 0) {
      throw new Error('RIBBON_POINTS vide')
    }

    const first = RIBBON_POINTS[0]
    const last = RIBBON_POINTS[RIBBON_POINTS.length - 1]

    let maxLatIdx = 0
    for (let i = 1; i < RIBBON_POINTS.length; i++) {
      if (RIBBON_POINTS[i].lat > RIBBON_POINTS[maxLatIdx].lat) maxLatIdx = i
    }
    const north = RIBBON_POINTS[maxLatIdx]

    const coords = RIBBON_POINTS.map((p) => `${p.lon},${p.lat},0`).join('\n')

    const pointPlacemark = (name: string, p: any, extra: string) => `
  <Placemark>
    <name>${esc(name)}</name>
    <description>${esc(extra)}</description>
    <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
  </Placemark>`

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LIM ribbon</name>
  <description>Export du ruban RIBBON_POINTS</description>

  <Placemark>
    <name>Ruban LAV050 (LineString)</name>
    <description>Points=${RIBBON_POINTS.length}</description>
    <Style><LineStyle><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>
${coords}
      </coordinates>
    </LineString>
  </Placemark>

  ${pointPlacemark('Start (index 0)', first, `index=0 | s_km=${first?.s_km ?? 'null'}`)}
  ${pointPlacemark('End (last index)', last, `index=${RIBBON_POINTS.length - 1} | s_km=${last?.s_km ?? 'null'}`)}
  ${pointPlacemark('Most north (max lat)', north, `index=${maxLatIdx} | s_km=${north?.s_km ?? 'null'}`)}

</Document>
</kml>`

    return kml
  }

  const runGpsReplayFromNdjson = async (file: File) => {
    try {
      setGpsReplayBusy(true)
      setGpsReplayProgress(0)

      // ✅ On évite de mélanger GPS live et replay
      stopGpsWatch()

      // s’assure que le moteur est prêt (il est déjà init au boot, mais garde-fou)
      if (!gpsPkReady) {
        await initGpsPkEngine()
        setGpsPkReady(true)
      }
      // ✅ Replay : repartir d’une mémoire PK propre (sinon dtMs est faux)
      resetGpsPkEngineMemory()

      // ✅ IMPORTANT : en replay, on impose le sens attendu au moteur (déterministe)
      // DOWN => PK décroissants => -1 ; UP => PK croissants => +1
      const dirForEngine: 1 | -1 | null =
        expectedDir === 'DOWN' ? -1 : expectedDir === 'UP' ? 1 : null

      setExpectedDirectionForReplay(dirForEngine, {
        source: 'replay_lock',
        train: trainDisplay ?? null,
      })

      const parseTms = (t: any): number | null => {
        if (typeof t === 'number' && Number.isFinite(t)) return Math.trunc(t)
        if (typeof t === 'string' && t.trim().length > 0) {
          const parsed = Date.parse(t)
          if (Number.isFinite(parsed)) return parsed
        }
        return null
      }

      // ✅ Vitesse replay (1 = temps réel, 2 = 2x plus vite, etc.)
      const SPEED = 60

      const text = await file.text()
      const lines = text.split(/\r?\n/)

      // ---- 1) On extrait tous les points gps:position du log ----
      const points: Array<{
        tLogMs: number
        tRaw: any
        payload: any
      }> = []

      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue

        let obj: any
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }

        if (obj?.kind !== 'gps:position') continue
        const tLogMs = parseTms(obj?.t)
        if (tLogMs == null) continue

        points.push({
          tLogMs,
          tRaw: obj?.t ?? null,
          payload: obj?.payload ?? {},
        })
      }

      if (points.length === 0) {
        window.alert('Replay GPS: aucun événement kind:"gps:position" lisible dans ce fichier.')
        return
      }

      // Tri sécurité
      points.sort((a, b) => a.tLogMs - b.tLogMs)

      // ---- 2) Horloge simulée : tLog → tSim (basé sur Date.now) ----
      const t0Log = points[0].tLogMs
      const t0Sim = Date.now()

      // 🔧 Horloge vue par FT = temps réel du log (non compressé)
      const toSimMs = (tLogMs: number) =>
        Math.trunc(t0Sim + (tLogMs - t0Log))

      // ---- 3) Export projection (comme avant) + injection timée dans FT ----
      const outLines: string[] = []
      outLines.push('# LIM gps replay projection')
      outLines.push(`# source=${file.name}`)
      outLines.push(`# generatedAt=${new Date().toISOString()}`)
      outLines.push('# format=one-JSON-per-line (NDJSON)')
      outLines.push('# kind=gps:replay:projection')

      let inCount = 0
      let outCount = 0

      for (let i = 0; i < points.length; i++) {
        const it = points[i]
        const p = it.payload ?? {}

        const lat = p?.lat
        const lon = p?.lon
        const accuracy = p?.accuracy

        if (typeof lat !== 'number' || typeof lon !== 'number') continue
        inCount++

        const simTs = toSimMs(it.tLogMs)

        // ✅ Temporisation entre points (respect du timing du log, modulé par SPEED)
        if (i > 0) {
          const prevSimTs = toSimMs(points[i - 1].tLogMs)
          // 🔧 Accélération appliquée seulement à l’attente réelle
          const waitMs = Math.max(0, (simTs - prevSimTs) / Math.max(0.0001, SPEED))
          if (waitMs > 0) {
            await new Promise((r) => window.setTimeout(r, waitMs))
          }
        }

        // En replay, on veut tester le moteur actuel => on recalcule systématiquement.
        let projOk = false

        const proj = projectGpsToPk(lat, lon, { nowMs: simTs })
        projOk = !!proj

        const pk = proj?.pk ?? null
        const s_km = proj?.s_km ?? null
        const distance_m = proj?.distance_m ?? null

        const nearestIdx = proj?.nearestIdx ?? null
        const nearestLat = proj?.nearestLat ?? null
        const nearestLon = proj?.nearestLon ?? null

        const pkCandidate = proj?.pkCandidate ?? null
        const pkDecision = proj?.pkDecision ?? null

        const dist = distance_m
        const onLine = dist != null && dist <= 200

        // ✅ Injection dans FT : même event que le live
        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat,
              lon,
              accuracy: typeof accuracy === 'number' ? accuracy : undefined,
              pk,
              s_km,
              distance_m,
              onLine,
              timestamp: simTs,

              // DEBUG : point ruban retenu / décision PK
              nearestIdx,
              nearestLat,
              nearestLon,
              pkCandidate,
              pkDecision,
            },
          })
        )

        // Export “projection pure” (comme avant)
        const record = {
          t: it.tRaw ?? null,
          kind: 'gps:replay:projection',
          payload: {
            lat,
            lon,
            accuracy: typeof accuracy === 'number' ? accuracy : null,

            projOk,
            pk,
            s_km,
            distance_m,

            nearestIdx,
            nearestLat,
            nearestLon,
            pkCandidate,
            pkDecision,
          },
        }

        outLines.push(JSON.stringify(record))
        outCount++

        // ✅ Progression UI (throttle léger)
        if (i % 20 === 0 || i === points.length - 1) {
          setGpsReplayProgress((i + 1) / points.length)
        }
      }

      outLines.push(`# stats_in=${inCount}`)
      outLines.push(`# stats_out=${outCount}`)

      downloadTextFile(
        'gps_replay_projection.ndjson',
        outLines.join('\n'),
        'application/x-ndjson'
      )

      window.alert(
        `Replay GPS terminé.\n\n` +
          `Points lus: ${inCount}\n` +
          `Points injectés/exportés: ${outCount}\n\n` +
          `Vitesse: x${SPEED}`
      )
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const stack = err?.stack ? String(err.stack) : ''

      console.warn('[TitleBar] GPS replay failed', err)
      if (stack) {
        console.warn('[TitleBar] GPS replay stack:\n' + stack)
      }

      const stackLine = stack.split('\n').slice(0, 2).join('\n')
      window.alert(`Replay GPS impossible: ${msg}\n\n${stackLine}`)
    } finally {
      setGpsReplayProgress(0)
      setGpsReplayBusy(false)
      // reset input pour permettre re-import même fichier
      if (gpsReplayInputRef.current) gpsReplayInputRef.current.value = ''
    }
  }

  const formatSignedHMS = (deltaSec: number): string => {
    const sign = deltaSec < 0 ? '-' : '+'
    const abs = Math.abs(deltaSec)
    const hh = Math.floor(abs / 3600)
    const mm = Math.floor((abs % 3600) / 60)
    const ss = abs % 60
    const pad2 = (n: number) => String(n).padStart(2, '0')
    // si < 1h, on affiche mm:ss ; sinon h:mm:ss
    return hh > 0 ? `${sign}${hh}:${pad2(mm)}:${pad2(ss)}` : `${sign}${mm}:${pad2(ss)}`
  }

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

    // ✅ Dernier fix GPS reçu (pour logique Figueres : zone + stabilité)
  // Alimenté par le listener 'gps:position'
  const lastGpsFixRef = useRef<{
    ts: number
    nearestIdx: number | null
    s_km: number | null
    onLine: boolean | null
  } | null>(null)
  // =========================
  // Figueres — détection "arrêt" (fixe) via ruban
  // - On considère "figé" si nearestIdx reste stable (±tolérance) pendant N ms
  // - N doit être cohérent avec ta règle FT (ex: 30s)
  // =========================
  const FIGUERES_STOP_STABLE_MS = 30_000 // 30s (à aligner avec ta règle métier)
  const figueresStableSinceRef = useRef<number | null>(null)
  const figueresStableIdxRef = useRef<number | null>(null)
  const figueresStopTriggeredRef = useRef(false)

  useEffect(() => {
    gpsStateRef.current = gpsState
  }, [gpsState])

    // ✅ Arme Figueres quand on voit du GPS GREEN dans la zone.
  // Important : on ne demande pas que GREEN reste pendant tout l’arrêt.
  useEffect(() => {
    if (gpsState !== 2) return // 2 = GREEN
    const fix = lastGpsFixRef.current
    if (!fix) return

    // ✅ REPLAY ONLY : auto-calib silencieux
    // On ne tente l’auto-calib que si le 1er GREEN est déjà "près" de la zone Figueres attendue.
    if (
      gpsReplayBusy &&
      figueresZoneMinRef.current == null &&
      figueresZoneMaxRef.current == null &&
      typeof fix.s_km === 'number' &&
      Number.isFinite(fix.s_km)
    ) {
      const zMin = FIGUERES_ZONE.sKmMin
      const zMax = FIGUERES_ZONE.sKmMax

      const hasBounds =
        typeof zMin === 'number' &&
        Number.isFinite(zMin) &&
        typeof zMax === 'number' &&
        Number.isFinite(zMax)

      // Si pas de bornes connues, on ne fait rien ici.
      if (hasBounds) {
        const minZ = Math.min(zMin as number, zMax as number) - 1.0 // marge 1 km
        const maxZ = Math.max(zMin as number, zMax as number) + 1.0

        const plausible = fix.s_km >= minZ && fix.s_km <= maxZ

        if (plausible) {
          figueresZoneMinRef.current = fix.s_km
          figueresZoneMaxRef.current = fix.s_km

          console.log('[Figueres][REPLAY] AUTO-CALIB ZONE', { s_km: fix.s_km })
          logTestEvent('figueres:calib:auto', {
            source: 'replay_auto',
            s_km: fix.s_km,
            tLocal: Date.now(),
          })
        }
        // ✅ sinon: silencieux (pas de "SKIP" spam au début du replay)
      }
    }


    figueresArmedRef.current = true

    // ✅ tArmed cohérent : en replay, fix.ts = temps simulé ; sinon Date.now()
    const tArmed =
      (typeof fix.ts === 'number' && Number.isFinite(fix.ts)) ? fix.ts : Date.now()

    figueresArmedAtRef.current = tArmed

    console.log('[Figueres] ARMED (GREEN in zone)', {
      s_km: fix?.s_km ?? null,
      idx: fix?.nearestIdx ?? null,
      tLocal: tArmed,
    })
    logTestEvent('figueres:armed', {
      reason: 'green_in_zone',
      s_km: fix?.s_km ?? null,
      nearestIdx: fix?.nearestIdx ?? null,
      tLocal: figueresArmedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsState, gpsReplayBusy])
  // ✅ Arrêt Figueres => bascule automatique du toggle FT
  // Conditions :
  // - Figueres "armé" (on a eu du GREEN dans la zone récemment)
  // - fix dans la zone (s_km)
  // - ruban stable >= FIGUERES_STOP_STABLE_MS
  useEffect(() => {
    const t = window.setInterval(() => {
      // 1) doit être armé
      if (!isFigueresArmed()) {
        figueresStopTriggeredRef.current = false
        return
      }

      const fix = lastGpsFixRef.current
      if (!fix) return

      // 2) doit être dans la zone Figueres
      if (!isInFigueresZone(fix)) {
        figueresStopTriggeredRef.current = false
        return
      }

      // 3) doit être stable (figé)
      const t0 = figueresStableSinceRef.current
      if (typeof t0 !== 'number' || !Number.isFinite(t0)) return

      // ✅ En replay on utilise l’horloge réelle, sinon timestamp GPS
const nowMs = gpsReplayBusy
  ? Date.now()
  : (lastGpsFixRef.current?.ts ?? Date.now())
const stableMs = nowMs - t0
      if (stableMs < FIGUERES_STOP_STABLE_MS) return

      // 4) éviter de retrigger en boucle
      if (figueresStopTriggeredRef.current) return
      figueresStopTriggeredRef.current = true

      // 👉 ACTION MÉTIER : bascule du toggle
      // Hypothèse : à Figueres on veut basculer sur FR (LFP).
      // Si tu veux l’inverse (ES), on changera UNE ligne.
      const target: 'FR' | 'ES' = 'FR'

      // Si l’utilisateur n’a pas engagé AUTO, on ne force pas
      if (!autoEngaged) {
        console.log('[Figueres][DEBUG] autoEngaged=', autoEngaged)
        logTestEvent('figueres:auto-switch:skipped', {
          reason: 'auto_not_engaged',
          target,
          stableMs,
          s_km: fix?.s_km ?? null,
          nearestIdx: fix?.nearestIdx ?? null,
        })
        return
      }

      setFtViewMode(target)
      logTestEvent('figueres:auto-switch:applied', {
        target,
        stableMs,
        s_km: fix?.s_km ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
      })

      console.log('[Figueres] AUTO SWITCH FT =>', target, {
        stableMs,
        s_km: fix?.s_km ?? null,
        idx: fix?.nearestIdx ?? null,
      })
    }, 250)

    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEngaged])

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
    // 1) émission immédiate
    window.dispatchEvent(
      new CustomEvent('lim:test-mode', {
        detail: { enabled: testModeEnabled },
      })
    )

    // 2) ✅ re-émission courte : rattrape les listeners montés après (race au boot)
    const t = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('lim:test-mode', {
          detail: { enabled: testModeEnabled },
        })
      )
    }, 400)

    return () => window.clearTimeout(t)
  }, [testModeEnabled])

  // ----- NUMÉRO DE TRAIN + TYPE + COMPOSITION -----
  const [trainDisplay, setTrainDisplay] = useState<string | undefined>(() => {
    const w = window as any
    const last: LIMFields | undefined = w.__limLastParsed
    const raw = last?.trenPadded ?? last?.tren
    return toTitleNumber(raw)
  })
  // ✅ Sécurité : si train non éligible FT France => forcer ADIF (ES)
  useEffect(() => {
    if (!trainDisplay) return

    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const FT_FR_WHITELIST = new Set<number>([9712, 9714, 9707, 9709, 9705, 9710])
    const isEligible = FT_FR_WHITELIST.has(n)

    if (!isEligible && ftViewMode !== 'ES') {
      setFtViewMode('ES')
      logTestEvent('ui:ftViewMode:force', {
        reason: 'train_not_eligible',
        train: trainDisplay,
        forcedMode: 'ES',
        source: 'titlebar',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

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

  // =========================
  // Direction attendue (PK)
  // =========================
  type ExpectedDir = 'UP' | 'DOWN' // UP => PK croissants, DOWN => PK décroissants

  const [expectedDir, setExpectedDir] = useState<ExpectedDir | null>(null)
  const expectedDirLockedRef = useRef(false)
  const expectedDirSourceRef = useRef<'train_number' | 'manual' | null>(null)
  const expectedDirTrainRef = useRef<string | null>(null) // ✅ train ayant servi au lock

  const emitExpectedDir = (dir: ExpectedDir, meta: { source: string }) => {
    // diffusion globale (FT ou autres modules pourront écouter)
    const detail = {
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      train: trainDisplay ?? null,
      locked: true,
      source: meta.source,
    }

    window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
    window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))

    // rattrapage boot (race listeners)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
      window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))
    }, 400)
  }

  // Lock automatique dès qu'on connaît le numéro de train
  // ✅ Si le train change, on re-lock automatiquement (nouveau run/nouveau PDF)
  useEffect(() => {
    if (!trainDisplay) return

    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const trainChanged = expectedDirTrainRef.current !== trainDisplay

    // si même train + déjà lock => rien à faire
    if (!trainChanged && expectedDirLockedRef.current) return

    const dir: ExpectedDir = n % 2 === 0 ? 'DOWN' : 'UP'

    expectedDirLockedRef.current = true
    expectedDirTrainRef.current = trainDisplay
    expectedDirSourceRef.current = 'train_number'
    setExpectedDir(dir)

    logTestEvent('direction:lock', {
      source: 'train_number',
      train: trainDisplay,
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      trainChanged,
    })

    emitExpectedDir(dir, { source: 'train_number' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

  useEffect(() => {
    const reset = () => {
      expectedDirLockedRef.current = false
      expectedDirTrainRef.current = null
      expectedDirSourceRef.current = null
      setExpectedDir(null)

      logTestEvent('direction:reset', { source: 'clear_pdf' })
    }

    window.addEventListener('lim:clear-pdf', reset as EventListener)
    window.addEventListener('ft:clear-pdf', reset as EventListener)
    return () => {
      window.removeEventListener('lim:clear-pdf', reset as EventListener)
      window.removeEventListener('ft:clear-pdf', reset as EventListener)
    }
  }, [])

  const [folded, setFolded] = useState(false)

  // ----- INFOS (à afficher depuis la roue dentée) -----
  const [aboutOpen, setAboutOpen] = useState(false)
  // ✅ Fermeture du menu Paramètres quand clic en dehors
  const settingsDetailsRef = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = settingsDetailsRef.current
      if (!el) return

      const isOpen = el.hasAttribute('open')
      if (!isOpen) return

      const target = e.target as Node | null
      if (!target) return

      // Si clic en dehors du <details>, on ferme
      if (!el.contains(target)) {
        el.removeAttribute('open')
      }
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any)
    }
  }, [])

  const CHANGELOG_TEXT = `🆕 Changelog – Optimisation du moteur de localisation GPS

🧭 Géométrie de ligne — ruban nettoyé et étendu
- Nettoyage complet du ruban géographique : suppression des branches parasites OSM.
- Recalage global de la géométrie pour obtenir une distance cohérente avec le terrain réel.
- Extension du ruban vers le nord : intégration des portions LFP et RFN (préparation future).

📍 Ancres PK — correction et enrichissement
- Repositionnement des ancres existantes pour correspondre au ruban nettoyé.
- Ajout de nouvelles ancres sur les zones LFP et RFN (provisoires, validation terrain prévue).
- Amélioration de la cohérence PK ↔ distance ruban sur l’ensemble de la ligne.

🚆 Localisation GPS
- Optimisation indirecte du moteur GPS grâce à une géométrie et des ancres plus fiables.
- Réduction des bascules de branche et amélioration de la stabilité du PK estimé.
- Meilleure continuité de localisation hors zones tunnel.

ℹ️ Note
- Les nouvelles ancres LFP et RFN sont préparatoires pour une future extension de l’application.
- Le fonctionnement actuel reste centré sur la portion ADIF.
`

  // ✅ Ouverture du panneau "À propos" depuis ailleurs (ex: toast App)
  useEffect(() => {
    const handler = () => {
      setAboutOpen(true)
      // Bonus : si le menu Paramètres est ouvert, on le ferme
      if (settingsDetailsRef.current?.hasAttribute('open')) {
        settingsDetailsRef.current.removeAttribute('open')
      }
    }

    window.addEventListener('lim:about-open', handler as EventListener)
    return () => {
      window.removeEventListener('lim:about-open', handler as EventListener)
    }
  }, [])

  // ----- MISE À JOUR PWA (Service Worker) -----
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null)

  const applySwUpdate = async () => {
    try {
      if (!('serviceWorker' in navigator)) return

      const reg = swRegRef.current ?? (await navigator.serviceWorker.getRegistration())
      if (!reg?.waiting) {
        console.log('[TitleBar][SW] no waiting worker')
        return
      }

      // Quand le nouveau SW devient contrôleur, on reload
      const onCtrl = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onCtrl)
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', onCtrl)

      // Demande au SW "waiting" de s’activer
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      console.log('[TitleBar][SW] SKIP_WAITING sent')
    } catch (err) {
      console.warn('[TitleBar][SW] apply update failed', err)
    }
  }

  useEffect(() => {
    // Pas de SW => rien à faire
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    const markIfWaiting = (reg: ServiceWorkerRegistration | null, reason: string) => {
      if (!reg) return
      swRegRef.current = reg

      if (reg.waiting && navigator.serviceWorker.controller) {
        setSwUpdateAvailable(true)
        console.log('[TitleBar][SW] update available (waiting)', reason)
      }
    }

    const attachUpdateFound = (reg: ServiceWorkerRegistration) => {
      // Quand un nouveau SW arrive (installing), on surveille jusqu’à "installed"
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return

        const onState = () => {
          if (cancelled) return

          // "installed" + controller présent => update dispo (waiting)
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            markIfWaiting(reg, 'updatefound:installed')
          }
        }

        nw.addEventListener('statechange', onState)
      })
    }

    const check = async (reason: string) => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (cancelled) return

        if (reg) {
          attachUpdateFound(reg)

          // Provoquer une vérification (important sur iOS/PWA)
          reg.update().catch(() => {})

          // Cas où c’est déjà en attente
          markIfWaiting(reg, reason)
        }
      } catch (err) {
        console.warn('[TitleBar][SW] check failed', err)
      }
    }

    // 1) check immédiat au boot
    check('boot')

    // 2) re-check léger après (iOS parfois tardif)
    const t1 = window.setTimeout(() => check('boot+800ms'), 800)
    const t2 = window.setTimeout(() => check('boot+2500ms'), 2500)

    // Quand le nouveau SW prend la main, l’update n’est plus "en attente"
    const onControllerChange = () => {
      setSwUpdateAvailable(false)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

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

      // 1) ID stable + stockage local replay-ready
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

      // ✅ log rejouable : import PDF (100% local)
      logTestEvent('import:pdf', {
        name: file.name,
        size: file.size,
        type: file.type || null,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : null,
        source: 'file-picker',
        pdfId,
        replayKey,
        storage: 'local',
      })

      // ✅ IMPORTANT : on déclenche le parsing sans aucun upload réseau
      window.dispatchEvent(
        new CustomEvent('lim:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )
      window.dispatchEvent(
        new CustomEvent('ft:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )
      window.dispatchEvent(
        new CustomEvent('lim:pdf-raw', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )

      // L’UI passe en NORMAL dès que l’import est lancé (parsing en cours)
      setPdfMode('green')
    }

    if (inputRef.current) inputRef.current.value = ''
  }

  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail

      // ✅ DEBUG / TEST : confirmer que lim:parsed arrive bien en TitleBar
      logTestEvent('ui:lim:parsed', {
        train: (detail as any)?.trenPadded ?? (detail as any)?.tren ?? null,
        type: (detail as any)?.type ?? null,
        composicion: (detail as any)?.composicion ?? (detail as any)?.unit ?? null,
        source: 'titlebar:onParsed',
      })

      // ✅ Spinner OFF : parsing terminé
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

      // =========================
      // Pré-calage GPS ponctuel (post-parsing)
      // =========================
      ;(async () => {
        try {
          // reset état "AUTO dispo" à chaque nouveau parsing
                    setAutoEngaged(false)

          setAutoResolved({
            available: false,
            side: null,
            s_km: null,
            pk: null,
            ts: Date.now(),
            reason: null,
          })

          if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            setAutoResolved((prev) => ({
              ...prev,
              available: false,
              side: null,
              reason: 'no_geolocation',
              ts: Date.now(),
            }))
            logTestEvent('ui:auto:precal:failed', { reason: 'no_geolocation', source: 'onParsed' })
            return
          }

          // ✅ s'assure que le moteur est prêt (sans toucher à sa logique)
          if (!gpsPkReady) {
            try {
              await initGpsPkEngine()
              setGpsPkReady(true)
            } catch {
              setAutoResolved((prev) => ({
                ...prev,
                available: false,
                side: null,
                reason: 'engine_not_ready',
                ts: Date.now(),
              }))
              logTestEvent('ui:auto:precal:failed', { reason: 'engine_not_ready', source: 'onParsed' })
              return
            }
          }

          const getPos = () =>
            new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                maximumAge: 10_000,
                timeout: 6_000,
              })
            })

          const pos = await getPos()
          const lat = pos.coords.latitude
          const lon = pos.coords.longitude
          const accuracy = pos.coords.accuracy

          const proj = projectGpsToPk(lat, lon)
          if (!proj) {
            setAutoResolved({
              available: false,
              side: null,
              s_km: null,
              pk: null,
              ts: Date.now(),
              reason: 'proj_null',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'proj_null',
              source: 'onParsed',
              lat,
              lon,
              accuracy,
            })
            return
          }

          const s_km =
            typeof proj.s_km === 'number' && Number.isFinite(proj.s_km) ? proj.s_km : null
          const pk = typeof proj.pk === 'number' && Number.isFinite(proj.pk) ? proj.pk : null

          const side = resolveSideFromSkm(s_km)

          if (side == null) {
            setAutoResolved({
              available: false,
              side: null,
              s_km,
              pk,
              ts: Date.now(),
              reason: 'no_s_km',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'no_s_km',
              source: 'onParsed',
              s_km,
              pk,
              lat,
              lon,
              accuracy,
            })
            return
          }

          setAutoResolved({
            available: true,
            side,
            s_km,
            pk,
            ts: Date.now(),
            reason: 'ok',
          })

          logTestEvent('ui:auto:precal:ok', {
            source: 'onParsed',
            side,
            s_km,
            pk,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
          })
        } catch (err: any) {
          const code = err?.code
          const isTimeout = code === 3
          const isDenied = code === 1

          const reason = isDenied ? 'permission_denied' : isTimeout ? 'timeout' : 'error'

          setAutoResolved((prev) => ({
            ...prev,
            available: false,
            side: null,
            reason,
            ts: Date.now(),
          }))

          logTestEvent('ui:auto:precal:failed', {
            reason,
            source: 'onParsed',
            code: typeof code === 'number' ? code : null,
            message: err?.message ?? String(err),
          })
        }
      })()
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

      // ✅ PROUVE ce que la TitleBar reçoit réellement
      console.log('[TitleBar] lim:schedule-delta detail =', ce?.detail)

      const rawText = ce?.detail?.text as string | null | undefined
      const isLarge = !!ce?.detail?.isLargeDelay

      // ✅ delta précis (secondes) optionnel — sera utilisé si présent
      const deltaSecRaw = ce?.detail?.deltaSec
      const deltaSec =
        typeof deltaSecRaw === 'number' && Number.isFinite(deltaSecRaw)
          ? Math.trunc(deltaSecRaw)
          : null

      const text = rawText && rawText.trim().length > 0 ? rawText.trim() : null

      // log labo : ce que la TitleBar reçoit et ce qu'elle va afficher
      logTestEvent('ui:schedule-delta', {
        text,
        isLarge,
      })

      if (text) {
        setScheduleDelta(text)
        setScheduleDeltaIsLarge(isLarge)

        // ✅ Ne PAS écraser si l'event ne fournit pas deltaSec
        if (deltaSec !== null) {
          setScheduleDeltaSec(deltaSec)
        }

        // log labo : ce que la TitleBar reçoit et ce qu'elle va afficher
        logTestEvent('ui:schedule-delta', {
          text,
          isLarge,
          deltaSec,
        })
      } else {
        // si on envoie texte vide ou null -> on efface
        setScheduleDelta(null)
        setScheduleDeltaIsLarge(false)
        setScheduleDeltaSec(null)

        logTestEvent('ui:schedule-delta', {
          text: null,
          isLarge: false,
          deltaSec: null,
        })
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

  // ✅ GPS (source de vérité FT) : la TitleBar affiche l'état calculé dans FT
  useEffect(() => {
    // ✅ Compteur local (debug) pour réduire le volume : on logge 1 fois sur N en RED
    let redSeq = 0

    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const state = ce?.detail?.state as 'RED' | 'ORANGE' | 'GREEN' | undefined
      const pk = ce?.detail?.pk as number | null | undefined
      const pkRaw = ce?.detail?.pkRaw as number | null | undefined
      const reasonCodes = ce?.detail?.reasonCodes as any

      // ✅ Log rejouable : on capture les raisons de RED (sans spammer)
      if (testModeEnabled && state === 'RED') {
        redSeq++
        if (redSeq % 10 === 1) {
          logTestEvent('ui:gps-state:red', {
            seq: redSeq,
            state,
            reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : null,
            pk: typeof pk === 'number' && Number.isFinite(pk) ? pk : null,
            pkRaw: typeof pkRaw === 'number' && Number.isFinite(pkRaw) ? pkRaw : null,
            tLocal: Date.now(),
          })
        }
      }

      if (state === 'RED') {
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      if (state === 'ORANGE') {
        setGpsState(1)
        if (typeof pkRaw === 'number' && Number.isFinite(pkRaw)) {
          setGpsPkDisplay(pkRaw.toFixed(1))
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ✅ Fix GPS brut (source: TitleBar → event gps:position)
  // Sert uniquement à mémoriser nearestIdx / s_km / onLine + timestamp pour la logique Figueres.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const d = (ce?.detail || {}) as any

      const nearestIdx =
        typeof d?.nearestIdx === 'number' && Number.isFinite(d.nearestIdx)
          ? Math.trunc(d.nearestIdx)
          : null

      const s_km =
        typeof d?.s_km === 'number' && Number.isFinite(d.s_km) ? Number(d.s_km) : null

      const onLine = typeof d?.onLine === 'boolean' ? d.onLine : null

      const ts =
        typeof d?.timestamp === 'number' && Number.isFinite(d.timestamp)
          ? Math.trunc(d.timestamp)
          : Date.now()

      // ✅ mémorisation du dernier fix utile Figueres
      lastGpsFixRef.current = { ts, nearestIdx, s_km, onLine }

      // ✅ détection "figé" (stabilité ruban)
      // On ne calcule la stabilité que si on a un idx et qu'on est sur la ligne.
      const now = ts // ts vient déjà de d.timestamp (ou Date.now fallback)
      if (nearestIdx != null && onLine === true) {
        const prevIdx = figueresStableIdxRef.current

        if (prevIdx == null) {
          figueresStableIdxRef.current = nearestIdx
          figueresStableSinceRef.current = now
        } else {
          const tol = FIGUERES_ZONE.stableIdxTolerance
          const dIdx = Math.abs(nearestIdx - prevIdx)

          if (dIdx <= tol) {
            // stable → on garde stableSince
          } else {
            // mouvement → on réarme la stabilité
            figueresStableIdxRef.current = nearestIdx
            figueresStableSinceRef.current = now
          }
        }
      } else {
        // pas exploitable → on réinitialise la stabilité
        figueresStableIdxRef.current = null
        figueresStableSinceRef.current = null
      }
    }

    window.addEventListener('gps:position', handler as EventListener)
    return () => window.removeEventListener('gps:position', handler as EventListener)
  }, [])






  // ----- GPS : démarrage / arrêt du watchPosition -----
  useEffect(() => {
    return () => {
      stopGpsWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startGpsWatch() {
    if (gpsWatchIdRef.current != null) {
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[TitleBar] Geolocation non disponible')
      logTestEvent('gps:watch:start:failed', { reason: 'no_geolocation' })
      return
    }

    console.log('[TitleBar] Démarrage watchPosition GPS...')
    logTestEvent('gps:watch:start', {})

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords

        gpsLastInfoRef.current = {
          lat: latitude,
          lon: longitude,
          accuracy,
        }

        if (!gpsPkReady) {
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
            `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → hors ruban (proj=null)`
          )
          logTestEvent('gps:position:offLine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const { pk, s_km, distance_m, nearestIdx, nearestLat, nearestLon, pkCandidate, pkDecision } = proj
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

        logTestEvent('gps:position', {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          distance_m: dist,
          onLine,
          nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
          nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
          nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
          pkCandidate: typeof pkCandidate === 'number' && Number.isFinite(pkCandidate) ? pkCandidate : null,
          pkDecision: pkDecision ?? null,
        })

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
              nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
              nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
              nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
              pkCandidate:
                typeof pkCandidate === 'number' && Number.isFinite(pkCandidate)
                  ? pkCandidate
                  : null,
              pkDecision: pkDecision ?? null,
            },
          })
        )

        console.log(
          `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → PK≈${pk?.toFixed?.(3)}  s≈${s_km?.toFixed?.(3)} km  dist=${dist?.toFixed?.(1)} m  onLine=${onLine}`
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
    // ✅ Quand la FT France (LFP) est affichée, on désactive le pliage/dépliage
    if (ftViewMode === 'FR') {
      logTestEvent('ui:blocked', {
        control: 'infosLtvFold',
        source: 'titlebar',
        reason: 'ftfrance_active',
      })
      return
    }

    if (simulationEnabled) {
      logTestEvent('ui:blocked', {
        control: 'infosLtvFold',
        source: 'titlebar',
      })
      return
    }

    setFolded((prev) => {
      const next = !prev

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
    <header id="lim-titlebar-root" className="surface-header rounded-2xl px-3 py-2 shadow-sm">
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

          {scheduleDelta && (
            <span
              className={
                scheduleDeltaIsLarge
                  ? 'text-xs italic text-red-500 dark:text-red-400 leading-none'
                  : 'text-xs italic text-gray-500 dark:text-gray-400 leading-none'
              }
            >
              {scheduleDelta}
              {testModeEnabled &&
                typeof scheduleDeltaSec === 'number' &&
                Number.isFinite(scheduleDeltaSec) && (
                  <>
                    {' '}
                    <span className="opacity-80 text-zinc-900 dark:text-zinc-100">
                      {formatSignedHMS(scheduleDeltaSec)}
                    </span>
                  </>
                )}
            </span>
          )}

          {pdfMode === 'green' && (
            <>
              {/* Auto-scroll */}
              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'autoScroll', source: 'titlebar' })
                    return
                  }

                  const next = !autoScroll

                  logTestEvent('ui:autoScroll:toggle', { enabled: next, source: 'titlebar' })

                  setAutoScroll(next)
                  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: next, source: 'titlebar' },
                    })
                  )

                  if (!simulationEnabled) {
                    if (next) startGpsWatch()
                    else stopGpsWatch()
                  }
                }}
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] transition
                  ${
                    autoScroll
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100'
                  }
                `}
                title={autoScroll ? 'Désactiver le défilement automatique' : 'Activer le défilement automatique'}
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
                  ${gpsState === 0 ? 'border-[3px] border-red-500 text-red-600 dark:text-red-400' : ''}
                  ${gpsState === 1 ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300' : ''}
                  ${gpsState === 2 ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300' : ''}
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
                  <span className="pointer-events-none absolute inset-1 z-20" aria-hidden>
                    <span
                      className="absolute top-1/2 left-1 right-1 h-[2px] bg-red-500/80"
                      style={{ transform: 'rotate(-28deg)', transformOrigin: 'center' }}
                    />
                  </span>
                )}
              </button>

              {/* Sens attendu (PK) */}
              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'expectedDirection', source: 'titlebar' })
                    return
                  }

                  if (!expectedDir) {
                    window.alert('Sens attendu indisponible (numéro de train manquant).')
                    return
                  }

                  const currentLabel = expectedDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'
                  const nextDir = expectedDir === 'DOWN' ? 'UP' : 'DOWN'
                  const nextLabel = nextDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'

                  const ok = window.confirm(
                    `Changer le sens attendu ?\n\nActuel : ${currentLabel}\nNouveau : ${nextLabel}\n\n(Le train ne change pas de sens : utilisez ceci seulement si le numéro de train ne correspond pas au sens réel.)`
                  )
                  if (!ok) return

                  setExpectedDir(nextDir)
                  expectedDirLockedRef.current = true
                  expectedDirSourceRef.current = 'manual'

                  logTestEvent('direction:manual_override', {
                    train: trainDisplay ?? null,
                    from: expectedDir,
                    to: nextDir,
                    source: 'titlebar',
                  })

                  emitExpectedDir(nextDir, { source: 'manual_override' })
                }}
                className={`
                  h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition
                  ${expectedDir ? 'border-[3px] border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-100' : 'border-[3px] border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'}
                `}
                title={
                  expectedDir === 'DOWN'
                    ? 'Sens attendu : PK décroissants (train pair) — cliquer pour changer'
                    : expectedDir === 'UP'
                      ? 'Sens attendu : PK croissants (train impair) — cliquer pour changer'
                      : 'Sens attendu indisponible'
                }
                aria-label="Sens attendu PK"
              >
                <span aria-hidden>{expectedDir === 'DOWN' ? '⬇️' : expectedDir === 'UP' ? '⬆️' : '↕️'}</span>
              </button>

              {/* Mode horaire — indicateur */}
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
            title={folded ? 'Afficher les blocs INFOS et LTV' : 'Afficher uniquement la zone FT'}
          >
            {fullTitle}
          </button>
        </div>

        {/* Droite — Contrôles */}
        <div className="flex items-center gap-2 relative z-10">
          {swUpdateAvailable && (
            <button
              type="button"
              onClick={() => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'swUpdate', source: 'titlebar' })
                  return
                }
                logTestEvent('ui:sw:update:click', { source: 'titlebar' })
                applySwUpdate()
              }}
              className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold flex items-center gap-2"
              title="Nouvelle version disponible — cliquer pour mettre à jour"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white/90" />
              MAJ
            </button>
          )}

          {/* Jour/Nuit */}
          <div className="h-8 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-700 flex" title="Jour / Nuit">
            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (!dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(false)}
              aria-label="Mode jour"
            >
              <IconSun />
            </button>

            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(true)}
              aria-label="Mode nuit"
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
              if (simulationEnabled) {
                logTestEvent('ui:blocked', { control: 'pdfModeButton', source: 'titlebar' })
                return
              }

              const anyRef = inputRef as any
              const currentInput = anyRef.current as HTMLInputElement | null

              if (pdfMode === 'blue') {
                handleImportClick()
                return
              }

              if (currentInput && (currentInput as any).__pdfClickTimer) {
                clearTimeout((currentInput as any).__pdfClickTimer)
                ;(currentInput as any).__pdfClickTimer = null

                if (pdfMode !== 'blue') {
                  setPdfMode('blue')
                }

                setFtViewMode('ES')

                setTrainDisplay(undefined)
                setTrainType(undefined)
                setTrainComposition(undefined)

                window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))

                return
              }

              if (currentInput) {
                ;(currentInput as any).__pdfClickTimer = setTimeout(() => {
                  ;(currentInput as any).__pdfClickTimer = null
                  if (pdfMode === 'green') setPdfMode('red')
                  else setPdfMode('green')
                }, 200)
              } else {
                if (pdfMode === 'green') setPdfMode('red')
                else setPdfMode('green')
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

          {/* FT LFP / AUTO / ADIF (3 positions) */}
          {trainDisplay &&
            (() => {
              const n = parseInt(trainDisplay, 10)
              if (!Number.isFinite(n)) return null

              const FT_FR_WHITELIST = new Set<number>([9712, 9714, 9707, 9709, 9705, 9710])
              const isEligible = FT_FR_WHITELIST.has(n)

              if (!isEligible) return null

              const isEven = n % 2 === 0
              const order = isEven ? (['FR', 'AUTO', 'ES'] as const) : (['ES', 'AUTO', 'FR'] as const)

              const labelOf = (mode: 'FR' | 'AUTO' | 'ES') =>
                mode === 'FR' ? 'LFP' : mode === 'ES' ? 'ADIF' : 'AUTO'

              return (
                <div
                  className="h-8 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-700 flex"
                  title="Choix FT : LFP / AUTO / ADIF"
                >
                  {order.map((mode) => {
                    const isAuto = mode === 'AUTO'
                    const autoAvailable = !!autoResolved.available
                    const autoDisabled = isAuto && !autoAvailable

                    const isSelected = ftViewMode === mode
                    const showAutoActive = isAuto && autoEngaged

                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={autoDisabled}
                        onClick={() => {
                          if (simulationEnabled) {
                            logTestEvent('ui:blocked', { control: 'ftViewMode', source: 'titlebar' })
                            return
                          }

                          // ✅ Annule un switch AUTO en attente si l’utilisateur reclique
                          if (autoSwitchTimerRef.current != null) {
                            window.clearTimeout(autoSwitchTimerRef.current)
                            autoSwitchTimerRef.current = null
                          }

                          // ✅ AUTO indisponible tant que FR/ES non déterminé
                          if (autoDisabled) {
                            logTestEvent('ui:ftViewMode:auto:blocked', {
                              source: 'titlebar',
                              reason: autoResolved.reason ?? 'not_available',
                            })
                            return
                          }

                          // ✅ Clic AUTO :
                          // - 1er clic : engage AUTO + applique la sélection auto (latence ergonomique)
                          // - clics suivants : NE RECALENT PAS sur la position réelle (AUTO reste verrouillé)
                          if (isAuto) {
                            if (autoEngaged) {
                              // déjà armé => on ne refait pas un choix auto
                              logTestEvent('ui:ftViewMode:auto:ignored', {
                                source: 'titlebar',
                                reason: 'already_engaged',
                                currentMode: ftViewMode,
                              })
                              return
                            }

                            setAutoEngaged(true)

                            // feedback immédiat : on affiche AUTO sélectionné pendant la latence
                            setFtViewMode('AUTO')
                            logTestEvent('ui:ftViewMode:change', { mode: 'AUTO', source: 'titlebar' })

                            const sideSnapshot = autoResolved.side
                            const target: 'ES' | 'FR' = sideSnapshot === 'FR' ? 'FR' : 'ES'

                            autoSwitchTimerRef.current = window.setTimeout(() => {
                              autoSwitchTimerRef.current = null
                              setFtViewMode(target)

                              logTestEvent('ui:ftViewMode:auto:apply', {
                                source: 'titlebar',
                                side: sideSnapshot,
                                target,
                                delayMs: 1000,
                              })
                            }, 1000)

                            return
                          }

                          // ✅ Clic ES/FR manuel :
                          // - on change l’affichage
                          // - MAIS on ne désarme jamais AUTO (il reste prêt pour Figueres)
                          setFtViewMode(mode)
                          logTestEvent('ui:ftViewMode:change', {
                            mode,
                            source: 'titlebar',
                            autoEngaged: autoEngaged,
                          })
                        }}

                        className={
                          'px-3 text-xs font-semibold ' +
                          (showAutoActive ? 'ring-2 ring-inset ring-emerald-500 dark:ring-emerald-400 ' : '') +
                          (isSelected
                            ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                            : autoDisabled
                              ? 'text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                              : isAuto && autoAvailable
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-zinc-700 dark:text-zinc-200')
                        }
                      >
                        {labelOf(mode)}
                      </button>
                    )
                  })}
                </div>



              )
            })()}

          {testModeEnabled && (
            <button
              type="button"
              onClick={async () => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'stopButton', source: 'titlebar' })
                  return
                }

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

                setScheduleDeltaSec(null)

                window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))

                if (testRecording) {
                  logTestEvent('ui:test:stop', { source: 'stop_button' })

                  stopTestSession()
                  setTestRecording(false)

                  // ✅ Export local immédiat (toujours)
                  try {
                    const exported = await exportTestLogLocal()
                    if (!exported) {
                      window.alert('Aucun événement de test à exporter.')
                      logTestEvent('testlog:export:failed', {
                        reason: 'no_events',
                        source: 'stop_button',
                      })
                    } else {
                      logTestEvent('testlog:exported', { source: 'stop_button' })
                    }
                  } catch (err: any) {
                    window.alert('Export local des logs impossible.')
                    logTestEvent('testlog:export:failed', {
                      reason: err?.message ?? String(err),
                      source: 'stop_button',
                    })
                  }
                }

                // ✅ Redémarrer immédiatement une nouvelle session de log
                const nextMode: 'blue' = 'blue'
                const labelParts: string[] = []
                if (trainDisplay) labelParts.push(`train_${trainDisplay}`)
                labelParts.push(`mode_${nextMode}`)
                labelParts.push('auto')

                const label = labelParts.join('_')
                startTestSession(label)
                setTestRecording(true)
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
          <details ref={settingsDetailsRef} className="relative">
            <summary
              className="list-none h-8 w-10 rounded-md bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-pointer select-none"
              title="Paramètres"
              aria-label="Paramètres"
            >
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
              <div className="text-[11px] font-semibold opacity-70 mb-2">Paramètres</div>

              {/* Toggle MODE TEST */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span className="font-semibold">Mode test</span>
                <input
                  type="checkbox"
                  checked={testModeEnabled}
                  onChange={async () => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'testModeToggle', source: 'settings' })
                      return
                    }

                    if (testModeEnabled) {
                      const wantDisable = window.confirm(
                        'Désactiver le mode test ?\n\n(équivaut à STOP : proposition d’exporter les logs)'
                      )
                      if (!wantDisable) return

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
                      window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))

                      if (testRecording) {
                        logTestEvent('ui:test:stop', { source: 'settings_toggle' })
                        stopTestSession()
                        setTestRecording(false)
                      }

                      try {
                        const exported = await exportTestLogLocal()
                        if (!exported) {
                          window.alert('Aucun événement de test à exporter.')
                          logTestEvent('testlog:export:failed', {
                            reason: 'no_events',
                            source: 'settings_toggle',
                          })
                        } else {
                          logTestEvent('testlog:exported', { source: 'settings_toggle' })
                        }
                      } catch (err: any) {
                        window.alert('Export local des logs impossible.')
                        logTestEvent('testlog:export:failed', {
                          reason: err?.message ?? String(err),
                          source: 'settings_toggle',
                        })
                      }

                      setTestModeEnabled(false)
                      return
                    }

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

              {/* Toggle OCR */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span>OCR online</span>
                <input
                  type="checkbox"
                  checked={ocrOnlineEnabled}
                  onChange={() => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'ocrOnlineToggle', source: 'settings' })
                      return
                    }

                    const next = !ocrOnlineEnabled
                    setOcrOnlineEnabledState(next)
                    logTestEvent('settings:ocrOnline:set', { enabled: next, source: 'settings' })
                  }}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              {/* GPS Replay (offline) */}
              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => gpsReplayInputRef.current?.click()}
                  disabled={gpsReplayBusy}
                  className={
                    gpsReplayBusy
                      ? 'relative overflow-hidden w-full h-8 px-3 text-xs rounded-md bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-not-allowed'
                      : 'w-full h-8 px-3 text-xs rounded-md bg-amber-500 text-white font-semibold flex items-center justify-center'
                  }
                  title="Importer un log NDJSON et exporter la projection GPS→PK (mode test)"
                >
                  {gpsReplayBusy && (
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        width: `${Math.max(0, Math.min(100, Math.round(gpsReplayProgress * 100)))}%`,
                      }}
                    >
                      <span className="absolute inset-0 bg-amber-500/60" />
                    </span>
                  )}

                  <span className="relative z-10">
                    {gpsReplayBusy ? 'Replay GPS…' : 'Importer GPS (replay offline)'}
                  </span>
                </button>
              )}

              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const kml = buildRibbonKml()
                      downloadTextFile(
                        'ribbon_LAV050.kml',
                        kml,
                        'application/vnd.google-earth.kml+xml'
                      )
                      window.alert('KML ruban exporté : ribbon_LAV050.kml')
                    } catch (err: any) {
                      console.warn('[TitleBar] export KML failed', err)
                      window.alert(`Export KML impossible: ${err?.message ?? String(err)}`)
                    }
                  }}
                  className="w-full h-8 px-3 text-xs rounded-md bg-indigo-600 text-white font-semibold flex items-center justify-center"
                  title="Exporter le ruban (KML) pour inspection dans Google Earth"
                >
                  Exporter KML ruban
                </button>
              )}

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              {/* À propos */}
              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'about', source: 'settings' })
                    return
                  }

                  logTestEvent('ui:about:open', { source: 'settings' })
                  setAboutOpen(true)
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">À propos</div>
                  <div className="text-[11px] opacity-70">LIM — version & changelog</div>
                </div>
              </button>
            </div>
          </details>

          {/* ✅ Fenêtre "À propos" */}
          {aboutOpen && (
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
              onClick={() => setAboutOpen(false)}
            >
              <div
                className="w-[min(900px,92vw)] max-h-[85vh] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">LIM</div>
                    <div className="text-xs opacity-70 tabular-nums">Version {APP_VERSION}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAboutOpen(false)}
                    className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
                  >
                    Fermer
                  </button>
                </div>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-3" />

                <div
                  className="rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/70 p-3 text-xs whitespace-pre-wrap overflow-auto"
                  style={{ maxHeight: '65vh' }}
                >
                  {CHANGELOG_TEXT}
                </div>
              </div>
            </div>
          )}

          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPickPdf} className="hidden" />

          <input
            ref={gpsReplayInputRef}
            type="file"
            accept=".log,.ndjson,application/json,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              await runGpsReplayFromNdjson(f)
            }}
            className="sr-only"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </header>
  )
}
