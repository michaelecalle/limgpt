export type GpsPkProjection = {
  pk: number | null
  s_km: number | null
  distance_m: number | null
}

import { RIBBON_POINTS } from './ligne050_ribbon'
import { ANCRES_PK_S } from './ancres_pk_s'

// drapeau simple : le moteur est prêt quand les données sont chargées
let engineReady = false

// ancres triées par s_km croissant (une seule fois)
const SORTED_ANCHORS = [...ANCRES_PK_S].sort((a, b) => a.s_km - b.s_km)

/**
 * Distance géodésique approximative (m) entre 2 points lat/lon en degrés.
 * Suffisant pour notre usage "sur / hors ruban".
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // m
  const toRad = (d: number) => (d * Math.PI) / 180
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * À partir d'un abscisse s (en km le long du ruban), renvoie un PK interpolé
 * à partir de la table d’ancres.
 */
function pkFromS(s_km: number | null | undefined): number | null {
  if (s_km == null || !Number.isFinite(s_km)) return null
  if (SORTED_ANCHORS.length === 0) return null

  // avant la première ancre → on "clipse" sur la première
  if (s_km <= SORTED_ANCHORS[0].s_km) {
    return SORTED_ANCHORS[0].pk
  }

  // après la dernière ancre → on "clipse" sur la dernière
  const last = SORTED_ANCHORS[SORTED_ANCHORS.length - 1]
  if (s_km >= last.s_km) {
    return last.pk
  }

  // recherche du segment [i, i+1] qui encadre s_km
  for (let i = 0; i < SORTED_ANCHORS.length - 1; i++) {
    const a = SORTED_ANCHORS[i]
    const b = SORTED_ANCHORS[i + 1]

    if (b.s_km === a.s_km) {
      // segment "plat" → on saute (cas 615.9 / 616.0 avec s=0)
      continue
    }

    if (s_km >= a.s_km && s_km <= b.s_km) {
      const t = (s_km - a.s_km) / (b.s_km - a.s_km)
      return a.pk + t * (b.pk - a.pk)
    }
  }

  // fallback (ne devrait pas arriver) → dernière ancre
  return last.pk
}

/**
 * Initialisation du moteur GPS → PK.
 * Ici, les données sont déjà embarquées dans le bundle → on marque
 * simplement le moteur comme "prêt".
 */
export async function initGpsPkEngine(): Promise<void> {
  if (engineReady) return
  engineReady = true

  if (typeof window !== 'undefined') {
    console.log('[gpsPkEngine] init — ruban LAV050 + ancres PK↔s chargés')
    console.log('[gpsPkEngine] points ruban :', RIBBON_POINTS.length)
    console.log('[gpsPkEngine] ancres PK↔s  :', SORTED_ANCHORS.length)
  }
}

/**
 * Projection d’un point (lat, lon) sur la ligne de référence.
 *
 * - Cherche le point du ruban le plus proche (en m, via haversine).
 * - Récupère s_km à cet endroit du ruban.
 * - Interpole un PK à partir de la table d’ancres PK↔s.
 * - Renvoie également la distance minimale au ruban en mètres.
 */
export function projectGpsToPk(lat: number, lon: number): GpsPkProjection | null {
  if (!engineReady) {
    return null
  }

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null
  }

  let bestIdx = -1
  let bestDist = Number.POSITIVE_INFINITY

  // brute force : on balaie tous les points du ruban
  for (let i = 0; i < RIBBON_POINTS.length; i++) {
    const p = RIBBON_POINTS[i]
    const d = haversineMeters(lat, lon, p.lat, p.lon)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }

  if (bestIdx < 0) {
    return null
  }

  const nearest = RIBBON_POINTS[bestIdx]
  const s_km = nearest.s_km
  const distance_m = bestDist
  const pk = pkFromS(s_km)

  return {
    pk,
    s_km,
    distance_m,
  }
}
