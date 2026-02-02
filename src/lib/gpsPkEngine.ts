export type GpsPkProjection = {
  // PK final (après garde-fous)
  pk: number | null

  // Abscisse ruban
  s_km: number | null
  distance_m: number | null

  // ===== DEBUG PK (hyper utile pour diagnostiquer les garde-fous) =====
  // PK brut issu de pkFromS(s_km) AVANT garde-fous
  pkCandidate?: number | null

  // Décision prise par les garde-fous
  pkDecision?: {
    reason:
      | "accepted"
      | "first_fix"
      | "no_candidate"
      | "fallback_lastAccepted"
      | "rejected_jump"
      | "rejected_direction"

    // Mémoire avant décision (ce qu'on avait en dernier PK accepté)
    lastAcceptedPk?: number | null
    lastAcceptedAtMs?: number | null

    // Direction attendue (train / override manuel)
    expectedDirection?: 1 | -1 | null
    expectedDirectionSource?: string | null
    expectedDirectionTrain?: string | null

    // Mesures courantes (si calculables)
    dtMs?: number | null
    allowedJumpKm?: number | null
    jumpKm?: number | null
    dir?: 1 | -1 | null
  }

  // DEBUG : point du ruban retenu
  nearestIdx?: number
  nearestLat?: number
  nearestLon?: number
}

import { RIBBON_POINTS } from "./ligne050_ribbon_dense"
import { ANCRES_PK_S } from "./ancres_pk_s"

// drapeau simple : le moteur est prêt quand les données sont chargées
let engineReady = false

// ----- GARDE-FOU #1 : anti-saut PK (mémoire du dernier PK accepté) -----
let lastAcceptedPk: { pk: number; atMs: number } | null = null

// ===== direction attendue (source train ou override manuel) =====
// +1 => PK croissants ; -1 => PK décroissants
let expectedDirection: 1 | -1 | null = null
let expectedDirectionSource: string | null = null
let expectedDirectionTrain: string | null = null
let expectedDirListenerAttached = false

// seuil minimal (km) au-delà duquel un mouvement dans le mauvais sens est jugé suspect
const DIRECTION_CHANGE_THRESHOLD_KM = 0.3

// Seuils simples (à ajuster après tests terrain)
const MAX_PLAUSIBLE_SPEED_KMH = 300
const PK_JUMP_MARGIN_KM = 0.25

// Fallback contrôlé : si pkCandidate est null mais qu'on est très proche du ruban,
// on conserve le dernier PK accepté au lieu de produire pk=null.
const MAX_DISTANCE_FOR_FALLBACK_M = 80

// Extrapolation ultra limitée au-delà des ancres (km)
const PK_FROM_S_EXTRAPOLATE_MARGIN_KM = 5

// ancres triées par s_km croissant (une seule fois)
const SORTED_ANCHORS = [...ANCRES_PK_S].sort((a, b) => a.s_km - b.s_km)

/**
 * Distance géodésique approximative (m) entre 2 points lat/lon en degrés.
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

  const first = SORTED_ANCHORS[0]
  const last = SORTED_ANCHORS[SORTED_ANCHORS.length - 1]

  if (s_km < first.s_km) {
    return null
  }

  if (s_km > last.s_km) {
    if (s_km > last.s_km + PK_FROM_S_EXTRAPOLATE_MARGIN_KM) {
      return null
    }

    // Extrapolation linéaire basée sur le dernier segment "non plat"
    for (let i = SORTED_ANCHORS.length - 2; i >= 0; i--) {
      const a = SORTED_ANCHORS[i]
      const b = SORTED_ANCHORS[i + 1]
      if (b.s_km === a.s_km) continue

      const t = (s_km - a.s_km) / (b.s_km - a.s_km)
      return a.pk + t * (b.pk - a.pk)
    }

    return null
  }

  // Recherche du segment [i, i+1] qui encadre s_km
  for (let i = 0; i < SORTED_ANCHORS.length - 1; i++) {
    const a = SORTED_ANCHORS[i]
    const b = SORTED_ANCHORS[i + 1]

    if (b.s_km === a.s_km) {
      continue
    }

    if (s_km >= a.s_km && s_km <= b.s_km) {
      const t = (s_km - a.s_km) / (b.s_km - a.s_km)
      return a.pk + t * (b.pk - a.pk)
    }
  }

  return null
}

function attachExpectedDirectionListenerIfNeeded() {
  if (expectedDirListenerAttached) return
  if (typeof window === "undefined") return

  const handler = (e: Event) => {
    const ce = e as CustomEvent<any>
    const d = ce?.detail ?? {}
    const dir = d?.expectedDir

    if (dir !== "UP" && dir !== "DOWN") return

    const next: 1 | -1 = dir === "UP" ? 1 : -1

    const train =
      typeof d?.train === "string" && d.train.trim().length > 0 ? d.train.trim() : null
    const source =
      typeof d?.source === "string" && d.source.trim().length > 0 ? d.source.trim() : null

    const changed = expectedDirection !== next || expectedDirectionTrain !== train

    expectedDirection = next
    expectedDirectionTrain = train
    expectedDirectionSource = source

    // Important : si contexte changé, on repart propre (évite mémoire d’un run précédent)
    if (changed) {
      lastAcceptedPk = null
    }
  }

  window.addEventListener("lim:expected-direction", handler as EventListener)
  window.addEventListener("ft:expected-direction", handler as EventListener)
  expectedDirListenerAttached = true
}

/**
 * Permet de repartir "propre" côté mémoire PK sans toucher à la direction attendue.
 * Utile pour les replays.
 */
export function resetGpsPkEngineMemory(): void {
  lastAcceptedPk = null
}

/**
 * Initialisation du moteur GPS → PK.
 */
export async function initGpsPkEngine(): Promise<void> {
  if (engineReady) return
  engineReady = true

  lastAcceptedPk = null
  expectedDirection = null
  expectedDirectionTrain = null
  expectedDirectionSource = null

  attachExpectedDirectionListenerIfNeeded()

  if (typeof window !== "undefined") {
    console.log("[gpsPkEngine] init — ruban LAV050 + ancres PK↔s chargés")
    console.log("[gpsPkEngine] points ruban :", RIBBON_POINTS.length)
    console.log("[gpsPkEngine] ancres PK↔s  :", SORTED_ANCHORS.length)
  }
}

type ProjectOptions = {
  /**
   * Timestamp à utiliser pour les garde-fous (ms).
   * - temps réel : laisser undefined
   * - replay : fournir la date du log (ex: Date.parse(obj.t))
   */
  nowMs?: number
}

/**
 * Projection d’un point (lat, lon) sur la ligne de référence.
 */
export function projectGpsToPk(lat: number, lon: number, options?: ProjectOptions): GpsPkProjection | null {
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
  const pkCandidate = pkFromS(s_km)

  // ===== DEBUG : snapshot de la mémoire AVANT décision =====
  const memLastPk = lastAcceptedPk?.pk ?? null
  const memLastAt = lastAcceptedPk?.atMs ?? null
  const memExpectedDir = expectedDirection ?? null
  const memExpectedSource = expectedDirectionSource ?? null
  const memExpectedTrain = expectedDirectionTrain ?? null

  // ✅ IMPORTANT : en replay, on doit utiliser le timestamp du log
  const nowMs =
    typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
      ? Math.trunc(options.nowMs)
      : Date.now()

  let pk = pkCandidate

  let decisionReason:
    | "accepted"
    | "first_fix"
    | "no_candidate"
    | "fallback_lastAccepted"
    | "rejected_jump"
    | "rejected_direction" = "no_candidate"

  let dtMs: number | null = null
  let allowedJumpKm: number | null = null
  let jumpKm: number | null = null
  let dir: 1 | -1 | null = null

  if (pkCandidate == null || !Number.isFinite(pkCandidate)) {
    if (
      lastAcceptedPk &&
      Number.isFinite(lastAcceptedPk.pk) &&
      Number.isFinite(distance_m) &&
      distance_m <= MAX_DISTANCE_FOR_FALLBACK_M
    ) {
      pk = lastAcceptedPk.pk
      lastAcceptedPk = { pk: lastAcceptedPk.pk, atMs: nowMs }
      decisionReason = "fallback_lastAccepted"
    } else {
      pk = null
      decisionReason = "no_candidate"
    }
  } else if (lastAcceptedPk && Number.isFinite(lastAcceptedPk.pk)) {
    dtMs = Math.max(1, nowMs - lastAcceptedPk.atMs)
    const dtH = dtMs / 3600000
    allowedJumpKm = MAX_PLAUSIBLE_SPEED_KMH * dtH + PK_JUMP_MARGIN_KM

    const deltaPk = pkCandidate - lastAcceptedPk.pk
    jumpKm = Math.abs(deltaPk)

    // direction du mouvement proposé (GPS observé)
    dir = deltaPk >= 0 ? 1 : -1

    if (jumpKm > allowedJumpKm) {
      pk = lastAcceptedPk.pk
      decisionReason = "rejected_jump"
    } else {
      // ✅ direction attendue FIXE (train/manuel)
      if (
        expectedDirection != null &&
        dir !== expectedDirection &&
        jumpKm >= DIRECTION_CHANGE_THRESHOLD_KM
      ) {
        pk = lastAcceptedPk.pk
        decisionReason = "rejected_direction"
      } else {
        pk = pkCandidate
        lastAcceptedPk = { pk: pkCandidate, atMs: nowMs }
        decisionReason = "accepted"
      }
    }
  } else {
    // Premier PK valide : initialise la mémoire
    lastAcceptedPk = { pk: pkCandidate, atMs: nowMs }
    pk = pkCandidate
    decisionReason = "first_fix"
  }

  return {
    pk,
    s_km,
    distance_m,

    pkCandidate,
    pkDecision: {
      reason: decisionReason,
      lastAcceptedPk: memLastPk,
      lastAcceptedAtMs: memLastAt,

      expectedDirection: memExpectedDir,
      expectedDirectionSource: memExpectedSource,
      expectedDirectionTrain: memExpectedTrain,

      dtMs,
      allowedJumpKm,
      jumpKm,
      dir,
    },

    nearestIdx: bestIdx,
    nearestLat: nearest.lat,
    nearestLon: nearest.lon,
  }
}
