import fs from "fs";
import path from "path";

const versionFile = path.resolve("./src/components/version.ts");

let content = fs.readFileSync(versionFile, "utf-8");

// Cherche une ligne du type : export const APP_VERSION = 'beta 2.100'
const match = content.match(/'beta\s+(\d+)\.(\d+)'/);

if (!match) {
  console.error("Impossible de trouver la version actuelle dans version.ts");
  process.exit(1);
}

let bloc = parseInt(match[1], 10);
let sub = parseInt(match[2], 10);

const oldVersion = `beta ${bloc}.${String(sub).padStart(3, "0")}`;

// Incrémentation de la partie YYY
sub++;
const newVersion = `beta ${bloc}.${String(sub).padStart(3, "0")}`;

content = content.replace(/'beta\s+\d+\.\d+'/, `'${newVersion}'`);
fs.writeFileSync(versionFile, content, "utf-8");

console.log(`Ancienne version : ${oldVersion}`);
console.log(`Nouvelle version  : ${newVersion}`);
