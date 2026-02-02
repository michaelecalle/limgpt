// scripts/export_ribbon_kml.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ✅ IMPORTANT : adapte ce chemin si ton ruban n’est pas ici
import { RIBBON_POINTS } from "../src/lib/ligne050_ribbon_dense";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const esc = (s: any) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function placemarkPoint(name: string, lat: number, lon: number, desc = "") {
  return `
  <Placemark>
    <name>${esc(name)}</name>
    ${desc ? `<description>${esc(desc)}</description>` : ""}
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`;
}

function lineString(name: string, coords: string, desc = "") {
  return `
  <Placemark>
    <name>${esc(name)}</name>
    ${desc ? `<description>${esc(desc)}</description>` : ""}
    <Style><LineStyle><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>
${coords}
      </coordinates>
    </LineString>
  </Placemark>`;
}

if (!Array.isArray(RIBBON_POINTS) || RIBBON_POINTS.length === 0) {
  throw new Error("RIBBON_POINTS vide ou introuvable");
}

const first = RIBBON_POINTS[0];
const last = RIBBON_POINTS[RIBBON_POINTS.length - 1];

let maxLatIdx = 0;
for (let i = 1; i < RIBBON_POINTS.length; i++) {
  if (RIBBON_POINTS[i].lat > RIBBON_POINTS[maxLatIdx].lat) maxLatIdx = i;
}
const north = RIBBON_POINTS[maxLatIdx];

const coords = RIBBON_POINTS.map((p) => `${p.lon},${p.lat},0`).join("\n");

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LIM ribbon</name>
  <description>Export du ruban RIBBON_POINTS</description>

  ${lineString("Ruban LAV050 (LineString)", coords, `Points=${RIBBON_POINTS.length}`)}
  ${placemarkPoint("Start (index 0)", first.lat, first.lon, `index=0 | s_km=${first?.s_km ?? "null"}`)}
  ${placemarkPoint("End (last index)", last.lat, last.lon, `index=${RIBBON_POINTS.length - 1} | s_km=${last?.s_km ?? "null"}`)}
  ${placemarkPoint("Most north (max lat)", north.lat, north.lon, `index=${maxLatIdx} | s_km=${north?.s_km ?? "null"}`)}

</Document>
</kml>
`;

const outPath = path.join(__dirname, "..", "ribbon_LAV050.kml");
fs.writeFileSync(outPath, kml, "utf8");

console.log("✅ KML écrit :", outPath);
console.log("   points:", RIBBON_POINTS.length);
console.log("   end:", last.lat, last.lon, "s_km:", last.s_km);
console.log("   most north:", maxLatIdx, north.lat, north.lon, "s_km:", north.s_km);
