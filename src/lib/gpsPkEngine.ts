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

    // ✅ DEBUG : permet de distinguer un accepted "normal" d'un accepted "relock"
    acceptedMode?: "normal" | "relock"

    // ✅ DEBUG : continuité ruban (écart en indices entre lastAcceptedIdx et idx retenu)
    deltaIdx?: number | null

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

// ✅ Mémoire du dernier point ruban associé au dernier PK accepté
// Sert au filtrage de continuité (évite les bascules de branche)
let lastAcceptedIdx: number | null = null

// ===== Relock automatique après trop de rejected_jump =====
let rejectStreakStartMs: number | null = null
const RELOCK_AFTER_MS = 15000 // 15s de rejets continus => on accepte une nouvelle base

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

// ✅ Anti-"reset temps" sur fixes immobiles : si le PK ne bouge pas vraiment,
// on évite de rafraîchir lastAcceptedPk.atMs (sinon dtMs redevient minuscule).
// 0.05 km = 50 m (ruban densifié à 25 m => bon compromis pour filtrer le bruit)
const TIME_RESET_EPS_KM = 0.05

// ✅ Anti-rejets "à quelques mètres" (ruban densifié ~25 m)
// On quantifie au pas du ruban pour stabiliser la comparaison jump vs seuil.
const JUMP_COMPARE_QUANTUM_KM = 0.025 // 25 m

function shouldRefreshAcceptedTimestamp(prevPk: number, nextPk: number): boolean {
  if (!Number.isFinite(prevPk) || !Number.isFinite(nextPk)) return true
  return Math.abs(nextPk - prevPk) >= TIME_RESET_EPS_KM
}

function ceilToQuantumKm(vKm: number, quantumKm: number): number {
  if (!Number.isFinite(vKm) || !Number.isFinite(quantumKm) || quantumKm <= 0) return vKm
  return Math.ceil(vKm / quantumKm) * quantumKm
}

function floorToQuantumKm(vKm: number, quantumKm: number): number {
  if (!Number.isFinite(vKm) || !Number.isFinite(quantumKm) || quantumKm <= 0) return vKm
  return Math.floor(vKm / quantumKm) * quantumKm
}

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
      lastAcceptedIdx = null
      rejectStreakStartMs = null
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
  lastAcceptedIdx = null
  rejectStreakStartMs = null
}

/**
 * En replay, on veut un comportement déterministe : le sens attendu est imposé
 * (souvent dérivé du numéro de train/PDF) et ne dépend pas d'un "lastDirection".
 */
export function setExpectedDirectionForReplay(
  dir: 1 | -1 | null,
  meta?: { source?: string; train?: string }
): void {
  expectedDirection = dir
  expectedDirectionSource = meta?.source ?? "replay"
  expectedDirectionTrain = meta?.train ?? null

  // Important : si on change le contexte, on repart propre pour éviter un "verrou" hérité.
  lastAcceptedPk = null
  lastAcceptedIdx = null
  rejectStreakStartMs = null
}

/**
 * Initialisation du moteur GPS → PK.
 */
export async function initGpsPkEngine(): Promise<void> {
  if (engineReady) return
  engineReady = true

  lastAcceptedPk = null
  lastAcceptedIdx = null
  rejectStreakStartMs = null

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
export function projectGpsToPk(
  lat: number,
  lon: number,
  options?: ProjectOptions
): GpsPkProjection | null {
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

  // ===== Filtrage candidats (K plus proches, puis continuité idx) =====
  const K_NEAREST = 10
  const MAX_CANDIDATE_DISTANCE_M = 120

  // Continuité : forte en mode normal, assouplie en "relock"
  // (relock = série de rejected_jump en cours OU fix ancien)
  const IDX_MAX_NORMAL = 120 // ~3 km (25 m * 120)
  const IDX_MAX_RELOCK = 600 // ~15 km (25 m * 600)
  const IDX_PENALTY_M = 1.5 // pénalité douce (le gros tri est fait par IDX_MAX)

  const nowMs =
    typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
      ? Math.trunc(options.nowMs)
      : Date.now()

  const isRelockPhase =
    rejectStreakStartMs != null ||
    (lastAcceptedPk != null &&
      Number.isFinite(lastAcceptedPk.atMs) &&
      nowMs - lastAcceptedPk.atMs >= RELOCK_AFTER_MS)

  const idxMax = isRelockPhase ? IDX_MAX_RELOCK : IDX_MAX_NORMAL

  type Cand = { idx: number; d: number }
  const bestK: Cand[] = []

  // Insertions dans une liste triée (taille <= K_NEAREST)
  const pushBestK = (c: Cand) => {
    let pos = 0
    while (pos < bestK.length && bestK[pos].d <= c.d) pos++
    bestK.splice(pos, 0, c)
    if (bestK.length > K_NEAREST) bestK.pop()
  }

  for (let i = 0; i < RIBBON_POINTS.length; i++) {
    const p = RIBBON_POINTS[i]
    const d = haversineMeters(lat, lon, p.lat, p.lon)

    // Si on a déjà K candidats meilleurs, on peut couper tôt sur les distances énormes
    // (petit gain perf, sans changer le résultat)
    if (bestK.length === K_NEAREST && d >= bestK[bestK.length - 1].d) continue

    pushBestK({ idx: i, d })
  }

  if (bestK.length === 0) {
    return null
  }

  // 1) Filtre distance <= 120m
  const within = bestK.filter((c) => c.d <= MAX_CANDIDATE_DISTANCE_M)

  // ✅ Spécification: on ne conserve QUE les candidats ≤ 120m.
  // S'il n'y en a aucun, on se met en "no_candidate" (pkCandidate=null).
  if (within.length === 0) {
    const bestIdx = bestK[0].idx
    const bestDist = bestK[0].d

    const nearest = RIBBON_POINTS[bestIdx]
    const s_km = nearest.s_km
    const distance_m = bestDist
    const pkCandidate = null

    // ===== DEBUG : snapshot de la mémoire AVANT décision =====
    const memLastPk = lastAcceptedPk?.pk ?? null
    const memLastAt = lastAcceptedPk?.atMs ?? null
    const memExpectedDir = expectedDirection ?? null
    const memExpectedSource = expectedDirectionSource ?? null
    const memExpectedTrain = expectedDirectionTrain ?? null

    let pk = pkCandidate

    let decisionReason:
      | "accepted"
      | "first_fix"
      | "no_candidate"
      | "fallback_lastAccepted"
      | "rejected_jump"
      | "rejected_direction" = "no_candidate"

    // ✅ DEBUG : distinguera accepted normal vs relock
    let acceptedMode: "normal" | "relock" | null = null

    // ✅ DEBUG : delta idx (ici on connaît bestIdx, mais pas de candidate valide)
    const deltaIdx =
      lastAcceptedIdx != null && Number.isFinite(lastAcceptedIdx)
        ? Math.abs(bestIdx - lastAcceptedIdx)
        : null

    let dtMs: number | null = null
    let allowedJumpKm: number | null = null
    let jumpKm: number | null = null
    let dir: 1 | -1 | null = null

    // ===== 1) Pas de candidate exploitable =====
    // (on reprend ton bloc existant tel quel, sans toucher aux garde-fous)
    if (
      lastAcceptedPk &&
      Number.isFinite(lastAcceptedPk.pk) &&
      Number.isFinite(distance_m) &&
      distance_m <= MAX_DISTANCE_FOR_FALLBACK_M
    ) {
      pk = lastAcceptedPk.pk
      lastAcceptedPk = { pk: lastAcceptedPk.pk, atMs: lastAcceptedPk.atMs }
      decisionReason = "fallback_lastAccepted"
    } else {
      pk = null
      decisionReason = "no_candidate"
    }

    return {
      pk,
      s_km,
      distance_m,

      pkCandidate,
      pkDecision: {
        reason: decisionReason,
        acceptedMode: acceptedMode ?? undefined,
        deltaIdx,
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

  // 2) Filtre continuité idx (si on a une mémoire)
  const candidates = within

  let contCandidates = candidates
  if (lastAcceptedIdx != null && Number.isFinite(lastAcceptedIdx)) {
    const filtered = candidates.filter((c) => Math.abs(c.idx - lastAcceptedIdx!) <= idxMax)
    if (filtered.length > 0) {
      contCandidates = filtered
    }
  }

  // 3) Score final : distance + petite pénalité de delta idx
  let chosen = contCandidates[0]
  let bestScore = Number.POSITIVE_INFINITY

  for (const c of contCandidates) {
    const deltaIdxLocal = lastAcceptedIdx != null ? Math.abs(c.idx - lastAcceptedIdx) : 0
    const score = c.d + deltaIdxLocal * IDX_PENALTY_M
    if (score < bestScore) {
      bestScore = score
      chosen = c
    }
  }

  const bestIdx = chosen.idx
  const bestDist = chosen.d

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

  // ✅ DEBUG : delta idx entre lastAcceptedIdx et bestIdx
  const deltaIdx =
    lastAcceptedIdx != null && Number.isFinite(lastAcceptedIdx)
      ? Math.abs(bestIdx - lastAcceptedIdx)
      : null

  let pk = pkCandidate

  let decisionReason:
    | "accepted"
    | "first_fix"
    | "no_candidate"
    | "fallback_lastAccepted"
    | "rejected_jump"
    | "rejected_direction" = "no_candidate"

  // ✅ DEBUG : distinguera accepted normal vs relock
  let acceptedMode: "normal" | "relock" | null = null

  let dtMs: number | null = null
  let allowedJumpKm: number | null = null
  let jumpKm: number | null = null
  let dir: 1 | -1 | null = null

  // ===== 1) Pas de candidate exploitable =====
  if (pkCandidate == null || !Number.isFinite(pkCandidate)) {
    // candidate impossible -> on reset la streak de rejected_jump (ce n'est pas un "jump")
    rejectStreakStartMs = null

    if (
      lastAcceptedPk &&
      Number.isFinite(lastAcceptedPk.pk) &&
      Number.isFinite(distance_m) &&
      distance_m <= MAX_DISTANCE_FOR_FALLBACK_M
    ) {
      pk = lastAcceptedPk.pk
      // ✅ On conserve atMs : fallback ne doit pas "consommer" le temps,
      // sinon on crée des rejected_jump artificiels au fix suivant.
      lastAcceptedPk = { pk: lastAcceptedPk.pk, atMs: lastAcceptedPk.atMs }
      // idx inchangé (fallback = on n'a pas validé un nouveau point ruban)
      decisionReason = "fallback_lastAccepted"
    } else {
      pk = null
      decisionReason = "no_candidate"
    }
  }
  // ===== 2) On a une mémoire lastAcceptedPk -> on applique garde-fous =====
  else if (lastAcceptedPk && Number.isFinite(lastAcceptedPk.pk)) {
    dtMs = Math.max(1, nowMs - lastAcceptedPk.atMs)
    const dtH = dtMs / 3600000
    allowedJumpKm = MAX_PLAUSIBLE_SPEED_KMH * dtH + PK_JUMP_MARGIN_KM

    const deltaPk = pkCandidate - lastAcceptedPk.pk
    jumpKm = Math.abs(deltaPk)

    // direction du mouvement proposé (GPS observé)
    dir = deltaPk >= 0 ? 1 : -1
    // --- garde-fou saut ---
    // ✅ Comparaison stabilisée au pas du ruban :
    // - on "arrondit vers le haut" le jump (pire cas)
    // - on "arrondit vers le bas" le seuil (pire cas)
    // Puis on applique la comparaison sur ces valeurs quantifiées.
    const jumpKmQ = ceilToQuantumKm(jumpKm, JUMP_COMPARE_QUANTUM_KM)
    const allowedJumpKmQ = floorToQuantumKm(allowedJumpKm, JUMP_COMPARE_QUANTUM_KM)

    if (jumpKmQ > allowedJumpKmQ) {
      // Début ou poursuite d'une série de rejets
      if (rejectStreakStartMs == null) {
        rejectStreakStartMs = nowMs
      }

      const rejectElapsed = nowMs - rejectStreakStartMs

      if (rejectElapsed >= RELOCK_AFTER_MS) {
        // ✅ Relock : on accepte le PK malgré le saut
        pk = pkCandidate
        acceptedMode = "relock"
        // Relock = vrai mouvement (saut important) => on rafraîchit toujours le temps
        lastAcceptedPk = { pk: pkCandidate, atMs: nowMs }
        lastAcceptedIdx = bestIdx
        decisionReason = "accepted"

        // reset streak
        rejectStreakStartMs = null
      } else {
        // rejet normal
        pk = lastAcceptedPk.pk
        decisionReason = "rejected_jump"
      }
    } else {
      // saut acceptable -> reset streak
      rejectStreakStartMs = null

      // --- garde-fou direction attendue ---
      if (
        expectedDirection != null &&
        dir !== expectedDirection &&
        jumpKm >= DIRECTION_CHANGE_THRESHOLD_KM
      ) {
        pk = lastAcceptedPk.pk

        // ✅ IMPORTANT : on rafraîchit le timestamp même en rejet direction
        // Sinon dtMs gonfle, allowedJumpKm devient énorme, et le relock (basé sur rejected_jump)
        // ne peut plus jamais se déclencher.
        lastAcceptedPk = { pk: lastAcceptedPk.pk, atMs: nowMs }

        decisionReason = "rejected_direction"
      } else {
        pk = pkCandidate

        const refreshAt = shouldRefreshAcceptedTimestamp(lastAcceptedPk.pk, pkCandidate)
        lastAcceptedPk = {
          pk: pkCandidate,
          atMs: refreshAt ? nowMs : lastAcceptedPk.atMs,
        }
        lastAcceptedIdx = bestIdx

        acceptedMode = "normal"
        decisionReason = "accepted"
      }
    }
  }
  // ===== 3) Premier PK valide : initialise la mémoire =====
  else {
    rejectStreakStartMs = null
    lastAcceptedPk = { pk: pkCandidate, atMs: nowMs }
    lastAcceptedIdx = bestIdx
    pk = pkCandidate
    acceptedMode = "normal"
    decisionReason = "first_fix"
  }

  return {
    pk,
    s_km,
    distance_m,

    pkCandidate,
    pkDecision: {
      reason: decisionReason,
      acceptedMode: acceptedMode ?? undefined,
      deltaIdx,
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
