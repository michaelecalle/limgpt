// scripts/export_ribbon_kml.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ⚠️ ajuste ce chemin si ton fichier ruban est ailleurs
import { RIBBON_POINTS } from "../src/lib/ligne050_ribbon_dense.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helpers
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function kmlPlacemarkPoint(name, lat, lon, desc = "") {
  return `
  <Placemark>
    <name>${esc(name)}</name>
    ${desc ? `<description>${esc(desc)}</description>` : ""}
    <Point>
      <coordinates>${lon},${lat},0</coordinates>
    </Point>
  </Placemark>`;
}

function kmlLineString(name, coordsLonLat, desc = "") {
  const coordText = coordsLonLat.map(([lon, lat]) => `${lon},${lat},0`).join("\n");
  return `
  <Placemark>
    <name>${esc(name)}</name>
    ${desc ? `<description>${esc(desc)}</description>` : ""}
    <Style>
      <LineStyle><width>3</width></LineStyle>
    </Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>
${coordText}
      </coordinates>
    </LineString>
  </Placemark>`;
}

// --- Build data ---
if (!Array.isArray(RIBBON_POINTS) || RIBBON_POINTS.length === 0) {
  throw new Error("RIBBON_POINTS vide ou introuvable");
}

// Coord list
const coords = RIBBON_POINTS.map((p) => [p.lon, p.lat]);

// Endpoints (par index)
const first = RIBBON_POINTS[0];
const last = RIBBON_POINTS[RIBBON_POINTS.length - 1];

// Also compute “most north” (max lat) just in case
let maxLatIdx = 0;
for (let i = 1; i < RIBBON_POINTS.length; i++) {
  if (RIBBON_POINTS[i].lat > RIBBON_POINTS[maxLatIdx].lat) maxLatIdx = i;
}
const north = RIBBON_POINTS[maxLatIdx];

// KML
const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LIM ribbon</name>
  <description>Export du ruban RIBBON_POINTS</description>

  ${kmlLineString(
    "Ruban LAV050 (LineString)",
    coords,
    `Points=${RIBBON_POINTS.length}`
  )}

  ${kmlPlacemarkPoint(
    "Start (index 0)",
    first.lat,
    first.lon,
    `index=0${first.s_km != null ? ` | s_km=${first.s_km}` : ""}`
  )}

  ${kmlPlacemarkPoint(
    "End (last index)",
    last.lat,
    last.lon,
    `index=${RIBBON_POINTS.length - 1}${last.s_km != null ? ` | s_km=${last.s_km}` : ""}`
  )}

  ${kmlPlacemarkPoint(
    "Most north (max lat)",
    north.lat,
    north.lon,
    `index=${maxLatIdx}${north.s_km != null ? ` | s_km=${north.s_km}` : ""}`
  )}

</Document>
</kml>
`;

const outPath = path.join(__dirname, "..", "ribbon_LAV050.kml");
fs.writeFileSync(outPath, kml, "utf8");
console.log("✅ KML écrit:", outPath);
console.log("   points:", RIBBON_POINTS.length);
console.log("   end index:", RIBBON_POINTS.length - 1, "lat/lon:", last.lat, last.lon, "s_km:", last.s_km);
console.log("   most north:", maxLatIdx, "lat/lon:", north.lat, north.lon, "s_km:", north.s_km);
