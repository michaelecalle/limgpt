/* eslint-disable no-console */
import * as fs from "node:fs"
import * as path from "node:path"
import { RIBBON_POINTS } from "../src/lib/ligne050_ribbon_dense.ts";

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
  OUT_KML: "out/ribbon_ambiguities_packets.kml",

  // Affichages
  DRAW_FULL_RIBBON: true,
  DRAW_PACKET_POLYLINES: true,
  DRAW_AMBIG_POINTS: false, // mets true si tu veux voir les points ambigus (peut être chargé)

  // Allègement
  RIBBON_STEP: 10, // 1 point sur 10 pour le ruban complet (0.25 km env) ; mets 1 pour full
  AMBIG_POINTS_STEP: 3, // si DRAW_AMBIG_POINTS=true : 1 point sur N

  // Style
  PACKET_LINE_WIDTH: 4,
  RIBBON_LINE_WIDTH: 2,
} as const

function kmlHeader(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Ruban ambiguïtés (paquets)</name>

  <Style id="ribbonStyle">
    <LineStyle><width>${CFG.RIBBON_LINE_WIDTH}</width></LineStyle>
  </Style>

  <Style id="packetStyleRed">
    <LineStyle><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>

  <Style id="packetStyleOrange">
    <LineStyle><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>

  <Style id="packetStyleYellow">
    <LineStyle><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>

  <Style id="ambPointStyle">
    <IconStyle>
      <scale>0.5</scale>
      <Icon>
        <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
      </Icon>
    </IconStyle>
  </Style>
`
}

// KML couleurs = aabbggrr (alpha, bleu, vert, rouge)
function styleForPacket(density: number): string {
  // rouge si très dense, orange moyen, jaune faible
  if (density >= 0.9) return "packetStyleRed"
  if (density >= 0.7) return "packetStyleOrange"
  return "packetStyleYellow"
}

// Encode couleur dans les styles (on garde 3 styles simples)
function kmlStyleColors(): string {
  // rouge: ff0000ff ; orange: ff00a5ff ; jaune: ff00ffff (approx)
  return `
  <Style id="packetStyleRed">
    <LineStyle><color>ff0000ff</color><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>
  <Style id="packetStyleOrange">
    <LineStyle><color>ff00a5ff</color><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>
  <Style id="packetStyleYellow">
    <LineStyle><color>ff00ffff</color><width>${CFG.PACKET_LINE_WIDTH}</width></LineStyle>
  </Style>
  <Style id="ribbonStyle">
    <LineStyle><color>ff888888</color><width>${CFG.RIBBON_LINE_WIDTH}</width></LineStyle>
  </Style>
`
}

function coordsFromIndices(pts: RibbonPoint[], indices: number[], step = 1): string {
  const coords: string[] = []
  for (let k = 0; k < indices.length; k += step) {
    const i = indices[k]
    const p = pts[i]
    if (!p) continue
    coords.push(`${p.lon},${p.lat},0`)
  }
  return coords.join(" ")
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
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
    process.exit(1)
  }

  const raw = fs.readFileSync(inPath, "utf8")
  const data = JSON.parse(raw) as AmbiguitiesFile

  let kml = kmlHeader()
  kml += kmlStyleColors()

  // Ruban complet (optionnel)
  if (CFG.DRAW_FULL_RIBBON) {
    const coords = coordsRange(pts, 0, pts.length - 1, CFG.RIBBON_STEP)
    kml += placemarkLine(
      `Ruban (step=${CFG.RIBBON_STEP})`,
      "ribbonStyle",
      coords,
      `Points: ${pts.length}`
    )
  }

  // Paquets
  if (CFG.DRAW_PACKET_POLYLINES) {
    for (let n = 0; n < data.packets.length; n++) {
      const p = data.packets[n]
      const span = p.end - p.start
      const density = span > 0 ? p.countAmbiguous / span : 1
      const styleId = styleForPacket(density)

      const coords = coordsRange(pts, p.start, p.end, 1)

      const desc = [
        `idx: ${p.start} → ${p.end} (span=${span})`,
        `ambiguous: ${p.countAmbiguous}`,
        `density≈${density.toFixed(2)}`,
        `sampleHits: ${p.sampleHits?.length ?? 0}`,
      ].join("<br/>")

      kml += placemarkLine(`Packet ${n + 1} — ${p.start}→${p.end}`, styleId, coords, desc)

      if (CFG.DRAW_AMBIG_POINTS) {
        const step = Math.max(1, CFG.AMBIG_POINTS_STEP)
        for (let k = 0; k < p.ambiguousIdx.length; k += step) {
          const idx = p.ambiguousIdx[k]
          const rp = pts[idx]
          if (!rp) continue
          kml += placemarkPoint(
            `amb idx ${idx}`,
            "ambPointStyle",
            rp.lon,
            rp.lat,
            `idx=${idx}<br/>s_km=${rp.s_km}`
          )
        }
      }
    }
  }

  kml += `
</Document>
</kml>
`

  const outPath = path.resolve(process.cwd(), CFG.OUT_KML)
  fs.writeFileSync(outPath, kml, "utf8")
  console.log("[export] wrote:", outPath)
}

main()
