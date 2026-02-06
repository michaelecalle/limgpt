/* eslint-disable no-console */
import * as fs from "node:fs"
import * as path from "node:path"
import { RIBBON_POINTS } from "../src/lib/ligne050_ribbon_dense.ts" // ✅ chemin confirmé chez toi

type RibbonPoint = { s_km: number; lat: number; lon: number }
type AmbiguityHit = { i: number; j: number; dist_m: number; deltaIdx: number }
type Packet = {
  start: number
  end: number
  countAmbiguous: number
  ambiguousIdx: number[]
  sampleHits: AmbiguityHit[]
}
type AmbiguitiesFile = {
  meta: any
  ambiguousIdx: number[]
  packets: Packet[]
}

const CFG = {
  INPUT_JSON: "out/ribbon_ambiguities_3030_11440.json",
  OUT_DIR: "out",

  // Détail visuel
  DRAW_PACKET_POLYLINE: true,
  DRAW_PACKET_AMBIG_POINTS: true,
  DRAW_SAMPLE_HIT_LINKS: true,

  // Allègement (si c’est trop lourd dans Google Earth)
  AMBIG_POINTS_STEP: 1, // 1 = tous les points ambigus du paquet (détail)
  MAX_LINKS: 300,       // limite de liens i↔j affichés (sampleHits)

  // Styles
  LINE_WIDTH_PACKET: 5,
  LINE_WIDTH_LINK: 2,
} as const

// --- CLI parsing ultra simple ---
function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx < 0) return null
  const v = process.argv[idx + 1]
  if (!v || v.startsWith("--")) return null
  return v
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

// KML couleurs = aabbggrr
const COLORS = {
  packet: "ff0000ff",     // rouge
  link: "ff00ffff",       // jaune
  ambPoint: "ff00a5ff",   // orange
} as const

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function placemarkLine(name: string, styleId: string, coords: string, desc?: string): string {
  const d = desc ? `<description><![CDATA[${desc}]]></description>` : ""
  return `
  <Placemark>
    <name>${escapeXml(name)}</name>
    ${d}
    <styleUrl>#${styleId}</styleUrl>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${coords}</coordinates>
    </LineString>
  </Placemark>
`
}

function placemarkPoint(name: string, styleId: string, lon: number, lat: number, desc?: string): string {
  const d = desc ? `<description><![CDATA[${desc}]]></description>` : ""
  return `
  <Placemark>
    <name>${escapeXml(name)}</name>
    ${d}
    <styleUrl>#${styleId}</styleUrl>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>
`
}

function coordsRange(pts: RibbonPoint[], start: number, end: number, step = 1): string {
  const coords: string[] = []
  const s = Math.max(0, start)
  const e = Math.min(pts.length - 1, end)
  for (let i = s; i <= e; i += step) {
    const p = pts[i]
    coords.push(`${p.lon},${p.lat},0`)
  }
  return coords.join(" ")
}

function coordsPairLine(pts: RibbonPoint[], i: number, j: number): string | null {
  const a = pts[i]
  const b = pts[j]
  if (!a || !b) return null
  return `${a.lon},${a.lat},0 ${b.lon},${b.lat},0`
}

function kmlHeader(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(title)}</name>

  <Style id="packetLine">
    <LineStyle><color>${COLORS.packet}</color><width>${CFG.LINE_WIDTH_PACKET}</width></LineStyle>
  </Style>

  <Style id="linkLine">
    <LineStyle><color>${COLORS.link}</color><width>${CFG.LINE_WIDTH_LINK}</width></LineStyle>
  </Style>

  <Style id="ambPoint">
    <IconStyle>
      <color>${COLORS.ambPoint}</color>
      <scale>0.55</scale>
      <Icon>
        <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
      </Icon>
    </IconStyle>
  </Style>
`
}

function main() {
  const pts = RIBBON_POINTS as RibbonPoint[]
  if (!Array.isArray(pts) || pts.length === 0) {
    console.error("RIBBON_POINTS vide ou invalide.")
    process.exit(1)
  }

  const inPath = path.resolve(process.cwd(), CFG.INPUT_JSON)
  if (!fs.existsSync(inPath)) {
    console.error("JSON introuvable:", inPath)
    console.error("Attendu:", CFG.INPUT_JSON)
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(inPath, "utf8")) as AmbiguitiesFile
  const packets = data.packets ?? []
  if (!packets.length) {
    console.error("Aucun packet dans le JSON.")
    process.exit(1)
  }

  // --- Choix du paquet ---
  // --packet 1 (1-based) : ordre du JSON
  // --rank 1 : tri par densité décroissante puis choisir le N-ième (recommandé)
  const packetStr = getArg("--packet")
  const rankStr = getArg("--rank")

  // tri par densité si --rank est fourni (sinon ordre natif)
  let chosen: Packet | null = null
  let chosenLabel = ""

  if (rankStr) {
    const rank = Math.max(1, parseInt(rankStr, 10) || 1)
    const ranked = packets
      .map((p, idx) => {
        const span = Math.max(1, p.end - p.start)
        const density = p.countAmbiguous / span
        return { p, idx, span, density }
      })
      .sort((a, b) => b.density - a.density)

    const item = ranked[rank - 1]
    if (!item) {
      console.error(`--rank ${rank} invalide (max=${ranked.length}).`)
      process.exit(1)
    }
    chosen = item.p
    chosenLabel = `rank${rank}_json#${item.idx + 1}_dens${item.density.toFixed(2)}`
  } else if (packetStr) {
    const n = Math.max(1, parseInt(packetStr, 10) || 1)
    const p = packets[n - 1]
    if (!p) {
      console.error(`--packet ${n} invalide (max=${packets.length}).`)
      process.exit(1)
    }
    chosen = p
    chosenLabel = `packet${n}`
  } else {
    // par défaut : le paquet #1 du JSON
    chosen = packets[0]
    chosenLabel = "packet1"
  }

  const p = chosen!
  const span = p.end - p.start
  const density = span > 0 ? p.countAmbiguous / span : 1

  const title = `Ruban — détail ${chosenLabel} — ${p.start}→${p.end}`
  let kml = kmlHeader(title)

  const desc = [
    `idx: ${p.start} → ${p.end} (span=${span})`,
    `ambiguous: ${p.countAmbiguous}`,
    `density≈${density.toFixed(2)}`,
    `sampleHits: ${p.sampleHits?.length ?? 0}`,
  ].join("<br/>")

  // Polyline du segment ruban du paquet
  if (CFG.DRAW_PACKET_POLYLINE) {
    const coords = coordsRange(pts, p.start, p.end, 1)
    kml += placemarkLine(`Segment ruban ${p.start}→${p.end}`, "packetLine", coords, desc)
  }

  // Points ambigus du paquet
  if (CFG.DRAW_PACKET_AMBIG_POINTS) {
    const step = Math.max(1, CFG.AMBIG_POINTS_STEP)
    for (let k = 0; k < p.ambiguousIdx.length; k += step) {
      const idx = p.ambiguousIdx[k]
      const rp = pts[idx]
      if (!rp) continue
      kml += placemarkPoint(
        `amb idx ${idx}`,
        "ambPoint",
        rp.lon,
        rp.lat,
        `idx=${idx}<br/>s_km=${rp.s_km}`
      )
    }
  }

  // Liens i↔j (sampleHits) : super utile pour voir l’autre branche
  if (CFG.DRAW_SAMPLE_HIT_LINKS && Array.isArray(p.sampleHits)) {
    const links = p.sampleHits.slice(0, CFG.MAX_LINKS)
    for (let n = 0; n < links.length; n++) {
      const h = links[n]
      const coords = coordsPairLine(pts, h.i, h.j)
      if (!coords) continue
      const ldesc = `i=${h.i}, j=${h.j}<br/>dist≈${h.dist_m.toFixed(1)}m<br/>Δidx=${h.deltaIdx}`
      kml += placemarkLine(`link ${n + 1}`, "linkLine", coords, ldesc)
    }
  }

  kml += `
</Document>
</kml>
`

  const outDir = path.resolve(process.cwd(), CFG.OUT_DIR)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const outPath = path.join(
    outDir,
    `ribbon_packet_detail_${chosenLabel}_${p.start}_${p.end}.kml`
  )
  fs.writeFileSync(outPath, kml, "utf8")
  console.log("[export] wrote:", outPath)

  // petit listing utile
  if (hasFlag("--list")) {
    console.log("Packets (json order):", packets.length)
  }
}

main()
