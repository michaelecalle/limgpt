/* eslint-disable no-console */

// Adapter ces chemins si besoin
import { RIBBON_POINTS } from "../src/lib/ligne050_ribbon_dense.ts"

import * as fs from "node:fs"
import * as path from "node:path"


type RibbonPoint = { s_km: number; lat: number; lon: number }

type AmbiguityHit = {
  i: number
  j: number
  dist_m: number
  deltaIdx: number
}

type Packet = {
  start: number
  end: number
  countAmbiguous: number
  ambiguousIdx: number[]
  // quelques hits pour diagnostic rapide (pas tout, sinon énorme)
  sampleHits: AmbiguityHit[]
}

const CFG = {
  // zone centrale à nettoyer
  IDX_MIN: 3030,
  IDX_MAX: 11440,

  // critères validés
  AMBIG_DIST_M: 40,
  AMBIG_DELTA_IDX_MIN: 50,

  // regroupement en paquets
  // (si deux indices ambigus sont à <= GAP, ils sont dans le même paquet)
  PACKET_GAP: 30,

  // grille spatiale (cellule ~ 40 m)
  GRID_CELL_M: 40,

  // limite de hits stockés (sinon ça peut gonfler)
  MAX_HITS_PER_I: 6,
  MAX_SAMPLE_HITS_PER_PACKET: 30,
} as const

// Conversion lat/lon -> plan (mètres) autour d'une latitude de référence
function metersProjector(points: RibbonPoint[]) {
  // lat0 = moyenne pour une meilleure stabilité sur toute la ligne
  let sumLat = 0
  for (const p of points) sumLat += p.lat
  const lat0 = (sumLat / Math.max(1, points.length)) * (Math.PI / 180)

  // origine : premier point (arbitraire)
  const lon0 = points[0]?.lon ?? 0
  const lat0deg = points[0]?.lat ?? 0

  const mPerDegLat = 111_320
  const mPerDegLon = Math.cos(lat0) * 111_320

  const originX = (lon0 * mPerDegLon)
  const originY = (lat0deg * mPerDegLat)

  return (p: RibbonPoint) => {
    const x = p.lon * mPerDegLon - originX
    const y = p.lat * mPerDegLat - originY
    return { x, y }
  }
}

function gridKey(ix: number, iy: number): string {
  return `${ix},${iy}`
}

function main() {
  const pts = RIBBON_POINTS as RibbonPoint[]
  if (!Array.isArray(pts) || pts.length === 0) {
    console.error("RIBBON_POINTS vide ou invalide.")
    process.exit(1)
  }

  console.log("[analyze] points:", pts.length)
  console.log("[analyze] zone:", CFG.IDX_MIN, "→", CFG.IDX_MAX)

  const project = metersProjector(pts)
  const cell = CFG.GRID_CELL_M

  // Pré-projection en mètres (accélère énormément)
  const xy = pts.map(project)

  // Grille: map cellKey -> liste d'indices
  const grid = new Map<string, number[]>()

  const idxMin = Math.max(0, CFG.IDX_MIN)
  const idxMax = Math.min(pts.length - 1, CFG.IDX_MAX)

  for (let i = idxMin; i <= idxMax; i++) {
    const { x, y } = xy[i]
    const ix = Math.floor(x / cell)
    const iy = Math.floor(y / cell)
    const key = gridKey(ix, iy)
    const arr = grid.get(key)
    if (arr) arr.push(i)
    else grid.set(key, [i])
  }

  console.log("[analyze] grid cells:", grid.size)

  const ambSet = new Set<number>()
  const hits: AmbiguityHit[] = []

  const r2 = CFG.AMBIG_DIST_M * CFG.AMBIG_DIST_M

  // pour chaque point i, chercher voisins proches dans grille 3x3
  for (let i = idxMin; i <= idxMax; i++) {
    const { x: xi, y: yi } = xy[i]
    const ix = Math.floor(xi / cell)
    const iy = Math.floor(yi / cell)

    let hitCountForI = 0

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = gridKey(ix + dx, iy + dy)
        const candidates = grid.get(key)
        if (!candidates) continue

        for (const j of candidates) {
          if (j === i) continue
          const deltaIdx = Math.abs(j - i)
          if (deltaIdx < CFG.AMBIG_DELTA_IDX_MIN) continue

          const { x: xj, y: yj } = xy[j]
          const ddx = xj - xi
          const ddy = yj - yi
          const d2 = ddx * ddx + ddy * ddy
          if (d2 > r2) continue

          ambSet.add(i)
          hitCountForI++

          if (hitCountForI <= CFG.MAX_HITS_PER_I) {
            hits.push({
              i,
              j,
              dist_m: Math.sqrt(d2),
              deltaIdx,
            })
          }

          // si on a déjà assez de hits pour ce i, inutile d'accumuler
          if (hitCountForI >= CFG.MAX_HITS_PER_I) break
        }
      }
    }
  }

  const ambiguousIdx = Array.from(ambSet).sort((a, b) => a - b)

  console.log("[analyze] ambiguous points:", ambiguousIdx.length)

  // Regroupement en paquets
  const packets: Packet[] = []
  if (ambiguousIdx.length > 0) {
    let cur: number[] = [ambiguousIdx[0]]

    for (let k = 1; k < ambiguousIdx.length; k++) {
      const prev = ambiguousIdx[k - 1]
      const next = ambiguousIdx[k]
      if (next - prev <= CFG.PACKET_GAP) {
        cur.push(next)
      } else {
        packets.push(buildPacket(cur, hits))
        cur = [next]
      }
    }
    packets.push(buildPacket(cur, hits))
  }

  console.log("[analyze] packets:", packets.length)

  // Export JSON
  const out = {
    meta: {
      idxMin,
      idxMax,
      pointsTotal: pts.length,
      thresholds: {
        dist_m: CFG.AMBIG_DIST_M,
        deltaIdxMin: CFG.AMBIG_DELTA_IDX_MIN,
      },
      packetGap: CFG.PACKET_GAP,
      gridCell_m: CFG.GRID_CELL_M,
    },
    ambiguousIdx,
    packets,
    // hits complets non exportés (peut être énorme).
    // Si tu les veux, on le fera en étape suivante (export séparé).
  }

  const outDir = path.resolve(process.cwd(), "out")
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, "ribbon_ambiguities_3030_11440.json")
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8")

  console.log("[analyze] wrote:", outPath)
}

function buildPacket(indices: number[], hits: AmbiguityHit[]): Packet {
  const start = indices[0]
  const end = indices[indices.length - 1]

  // hits associés au paquet (échantillonnage)
  const packetHits = hits.filter((h) => h.i >= start && h.i <= end)

  return {
    start,
    end,
    countAmbiguous: indices.length,
    ambiguousIdx: indices,
    sampleHits: packetHits.slice(0, CFG.MAX_SAMPLE_HITS_PER_PACKET),
  }
}

main()
