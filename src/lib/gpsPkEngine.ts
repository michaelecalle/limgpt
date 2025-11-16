// src/lib/gpsPkEngine.ts
//
// Petit moteur générique pour projeter un point GPS sur le ruban
// Can Tunis -> Frontière, puis estimer un PK à partir de s_km.
//
// Il s'appuie sur deux fichiers placés dans public/gps :
//   - /gps/lav_050_can_tunis_frontiere_clean.json  (ruban OSM nettoyé)
//   - /gps/ancres_pk_s.csv                         (ancres ADIF PK <-> s_km)
//
// Ce module NE dépend d'aucun composant React. Il peut être utilisé
// aussi bien par un "gps-lab" que par la FT ou la TitleBar plus tard.
//

// ----------------------
// Types publics
// ----------------------

export type GpsProjectionStatus = "OFF" | "WEAK" | "ON"

export interface GpsProjectionResult {
  status: GpsProjectionStatus
  // position brute
  lat: number
  lon: number
  // distance au ruban (m), null si modèle non prêt
  distToLineM: number | null
  // abscisse curviligne sur le ruban (km), null si hors modèle
  sKm: number | null
  // PK estimé (km), null si hors modèle
  pk: number | null
  // pour debug/scroll : index du point de ruban le plus proche
  nearestIndex: number | null
}

// ----------------------
// Types internes
// ----------------------

interface RubanPoint {
  lat: number
  lon: number
  sKm: number // abscisse cumulée en km
}

interface Anchor {
  pk: number
  sKm: number
}

// ----------------------
// Config
// ----------------------

// chemins dans /public
const RUBAN_URL = "/gps/lav_050_can_tunis_frontiere_clean.json"
const ANCHORS_URL = "/gps/ancres_pk_s.csv"

// seuils (à ajuster si besoin)
const MAX_ON_DISTANCE_M = 200 // ON si <= 200 m
const MAX_WEAK_DISTANCE_M = 1000 // WEAK si <= 1 km, sinon OFF

// ----------------------
// Stockage en mémoire
// ----------------------

let rubanCache: RubanPoint[] | null = null
let anchorsCache: Anchor[] | null = null
let loadPromise: Promise<void> | null = null

// ----------------------
// Utilitaires géo
// ----------------------

const R_EARTH_M = 6371000 // rayon approx Terre en mètres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const rLat1 = toRad(lat1)
  const rLat2 = toRad(lat2)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R_EARTH_M * c
}

// ----------------------
// Chargement des données
// ----------------------

async function loadModelIfNeeded(): Promise<void> {
  if (rubanCache && anchorsCache) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    // 1) Ruban : JSON = [[lat, lon], [lat, lon], ...]
    const rubanRes = await fetch(RUBAN_URL)
    if (!rubanRes.ok) {
      console.warn("[gpsPkEngine] Impossible de charger le ruban :", RUBAN_URL, rubanRes.status)
      rubanCache = []
    } else {
      const raw: [number, number][] = await rubanRes.json()
      const arr: RubanPoint[] = []
      let sCumKm = 0

      for (let i = 0; i < raw.length; i++) {
        const [lat, lon] = raw[i]
        if (i === 0) {
          arr.push({ lat, lon, sKm: 0 })
        } else {
          const prev = arr[i - 1]
          const d = haversineMeters(prev.lat, prev.lon, lat, lon) / 1000 // km
          sCumKm += d
          arr.push({ lat, lon, sKm: sCumKm })
        }
      }

      rubanCache = arr
      console.log(
        `[gpsPkEngine] Ruban chargé : ${arr.length} points, longueur ≈ ${sCumKm.toFixed(1)} km`
      )
    }

    // 2) Ancres : CSV pk;label;lat;lon;index_ruban;s_km;distance_m
    const anchorsRes = await fetch(ANCHORS_URL)
    if (!anchorsRes.ok) {
      console.warn("[gpsPkEngine] Impossible de charger les ancres :", ANCHORS_URL, anchorsRes.status)
      anchorsCache = []
    } else {
      const text = await anchorsRes.text()
      const lines = text.split(/\r?\n/).map((l) => l.trim())
      const anchors: Anchor[] = []

      for (const line of lines) {
        if (!line || line.startsWith("pk;")) continue // header ou ligne vide
        const parts = line.split(";")
        if (parts.length < 6) continue

        const pk = parseFloat(parts[0].replace(",", "."))
        const sStr = parts[5]?.replace(",", ".") ?? ""
        const sKm = parseFloat(sStr)

        if (Number.isFinite(pk) && Number.isFinite(sKm)) {
          anchors.push({ pk, sKm })
        }
      }

      anchors.sort((a, b) => a.sKm - b.sKm)
      anchorsCache = anchors
      console.log(`[gpsPkEngine] Ancres chargées : ${anchors.length} points`)
    }
  })()

  return loadPromise
}

// ----------------------
// Interpolation PK(s)
// ----------------------

function estimatePkFromS(sKm: number, anchors: Anchor[]): number | null {
  if (!anchors.length) return null

  // Avant la 1re ancre -> PK de la 1re
  if (sKm <= anchors[0].sKm) return anchors[0].pk
  // Après la dernière -> PK de la dernière
  const last = anchors[anchors.length - 1]
  if (sKm >= last.sKm) return last.pk

  // Cherche les deux ancres qui encadrent sKm
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (sKm >= a.sKm && sKm <= b.sKm) {
      const span = b.sKm - a.sKm
      if (span <= 0.000001) return a.pk
      const t = (sKm - a.sKm) / span
      return a.pk + t * (b.pk - a.pk)
    }
  }

  // Ne devrait pas arriver, mais au cas où :
  return last.pk
}

// ----------------------
// Projection lat/lon -> ruban
// ----------------------

function findNearestPointOnRuban(
  lat: number,
  lon: number,
  ruban: RubanPoint[]
): { index: number; distM: number; sKm: number } | null {
  if (!ruban.length) return null

  let bestIndex = 0
  let bestDist = Infinity

  for (let i = 0; i < ruban.length; i++) {
    const p = ruban[i]
    const d = haversineMeters(lat, lon, p.lat, p.lon)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  }

  return { index: bestIndex, distM: bestDist, sKm: ruban[bestIndex].sKm }
}

// ----------------------
// API publique
// ----------------------

// À appeler une fois au démarrage (par ex. dans App.tsx ou dans un hook global)
export async function initGpsPkModel(): Promise<void> {
  await loadModelIfNeeded()
}

// Projection complète : GPS -> ruban -> s_km -> PK
export async function projectLatLonToPk(
  lat: number,
  lon: number
): Promise<GpsProjectionResult> {
  await loadModelIfNeeded()

  if (!rubanCache || !anchorsCache) {
    return {
      status: "OFF",
      lat,
      lon,
      distToLineM: null,
      sKm: null,
      pk: null,
      nearestIndex: null,
    }
  }

  const nearest = findNearestPointOnRuban(lat, lon, rubanCache)
  if (!nearest) {
    return {
      status: "OFF",
      lat,
      lon,
      distToLineM: null,
      sKm: null,
      pk: null,
      nearestIndex: null,
    }
  }

  const { distM, sKm, index } = nearest
  const pk = estimatePkFromS(sKm, anchorsCache)

  let status: GpsProjectionStatus
  if (distM <= MAX_ON_DISTANCE_M) status = "ON"
  else if (distM <= MAX_WEAK_DISTANCE_M) status = "WEAK"
  else status = "OFF"

  return {
    status,
    lat,
    lon,
    distToLineM: distM,
    sKm,
    pk,
    nearestIndex: index,
  }
}
