import { BUILD_TIME, BUILD_HASH } from '../buildInfo'

// Affichage lisible humainement
// ex : "2026-01-26 15:42 (a1b2c3d)"
export const APP_VERSION =
  BUILD_HASH && BUILD_HASH.trim().length > 0
    ? `${BUILD_TIME} (${BUILD_HASH})`
    : BUILD_TIME
