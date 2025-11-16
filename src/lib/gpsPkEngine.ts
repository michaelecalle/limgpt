// src/lib/gpsPkEngine.ts

export type GpsPkProjection = {
  pk: number | null
  s_km: number | null
  distance_m: number | null
}

let engineReady = false

/**
 * Initialisation du moteur GPS → PK.
 * Pour l’instant, c’est un stub : on se contente de marquer le moteur comme "prêt".
 * La vraie logique (ruban + ancres) sera branchée dans une étape suivante.
 */
export async function initGpsPkEngine(): Promise<void> {
  if (engineReady) return
  engineReady = true
  if (typeof window !== 'undefined') {
    console.log('[gpsPkEngine] init — stub (sans ruban ni ancres pour le moment)')
  }
}

/**
 * Projection d’un point (lat, lon) sur la ligne.
 * Stub actuel : toujours "hors ligne" → retourne null.
 *
 * Dans la prochaine étape, on utilisera ici :
 * - le ruban propre (lav_050_can_tunis_frontiere_clean)
 * - la table d’ancres PK↔s (ancres_pk_s)
 * pour renvoyer un PK estimé et une distance au ruban.
 */
export function projectGpsToPk(lat: number, lon: number): GpsPkProjection | null {
  if (!engineReady) {
    // moteur pas initialisé → on signale "rien"
    return null
  }

  // Pour l’instant, on ne sait pas encore projeter → on renvoie null
  // (TitleBar interprétera ça comme "GPS présent mais pas calé sur la ligne").
  return null
}
