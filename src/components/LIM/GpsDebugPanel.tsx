import React, { useEffect, useState } from 'react'
import { initGpsPkEngine, projectGpsToPk } from '../../lib/gpsPkEngine'

const GpsDebugPanel: React.FC = () => {
  const [ready, setReady] = useState(false)

  // On initialise le moteur GPS→PK (comme dans la TitleBar)
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await initGpsPkEngine()
        if (!cancelled) {
          setReady(true)
          console.log('[GpsDebugPanel] gpsPkEngine prêt')
        }
      } catch (err) {
        console.error('[GpsDebugPanel] Erreur init gpsPkEngine', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // 1) Simuler "pas de fix GPS" → icône rouge, pas de PK
  const simulateNoFix = () => {
    window.dispatchEvent(
      new CustomEvent('gps:position', {
        detail: {
          // pas de lat/lon => la TitleBar considère "pas de fix"
          lat: null,
          lon: null,
          accuracy: null,
          pk: null,
          s_km: null,
          distance_m: null,
          onLine: false,
          timestamp: Date.now(),
        },
      })
    )
  }

  // 2) Simuler un fix hors ligne (ex: Paris) → icône orange, pas de PK
  const simulateOffLine = () => {
    const lat = 48.8566
    const lon = 2.3522

    window.dispatchEvent(
      new CustomEvent('gps:position', {
        detail: {
          lat,
          lon,
          accuracy: 10,
          pk: null,
          s_km: null,
          distance_m: 50000, // 50 km du ruban, clairement hors ligne
          onLine: false,
          timestamp: Date.now(),
        },
      })
    )
  }

  // 3) Simuler un fix "sur ligne" vers BARCELONA SANTS (~PK 621.0)
  const simulateOnLineSants = () => {
    // Coordonnées de l’ancre PK 621.0 (d’après ancres_pk_s)
    const lat = 41.3789611
    const lon = 2.1398342

    const proj = projectGpsToPk(lat, lon)
    const pk = proj?.pk ?? null
    const s_km = proj?.s_km ?? null
    const distance_m = proj?.distance_m ?? null
    const onLine = distance_m != null && distance_m <= 200

    console.log('[GpsDebugPanel] projection SANTS =', proj)

    window.dispatchEvent(
      new CustomEvent('gps:position', {
        detail: {
          lat,
          lon,
          accuracy: 5,
          pk,
          s_km,
          distance_m,
          onLine,
          timestamp: Date.now(),
        },
      })
    )
  }

  if (typeof window === 'undefined') {
    return null
  }

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 4,
        display: 'flex',
        gap: 8,
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: 11,
        opacity: 0.9,
      }}
    >
      <span style={{ opacity: 0.6 }}>GPS debug&nbsp;:</span>

      <button
        type="button"
        onClick={simulateNoFix}
        style={{
          padding: '3px 8px',
          borderRadius: 999,
          border: '1px solid #aaa',
          background: '#f3f3f3',
          cursor: 'pointer',
        }}
      >
        Pas de fix
      </button>

      <button
        type="button"
        onClick={simulateOffLine}
        style={{
          padding: '3px 8px',
          borderRadius: 999,
          border: '1px solid #f97316',
          background: '#ffedd5',
          cursor: 'pointer',
        }}
      >
        Hors ligne
      </button>

      <button
        type="button"
        onClick={simulateOnLineSants}
        disabled={!ready}
        style={{
          padding: '3px 8px',
          borderRadius: 999,
          border: '1px solid #22c55e',
          background: ready ? '#dcfce7' : '#e5e7eb',
          cursor: ready ? 'pointer' : 'not-allowed',
          fontWeight: 600,
        }}
      >
        Sur ligne (PK 621.0)
      </button>
    </div>
  )
}

export default GpsDebugPanel
