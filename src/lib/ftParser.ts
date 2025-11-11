// src/lib/ftParser.ts
//
// Étape 1 : extraction texte multi-page + fallback OCR Vision
// - écoute "ft:import-pdf"
// - renvoie "ft:parsedRaw" avec le texte brut par page
//
// On ajoute aussi :
// - l’extraction des heures (ft:heures)
// - la détection de la colonne COM "C" par coordonnées (PDF + OCR Vision)
// - l’association COM ↔ HORA (ft:codesC:resolved)
// - la détection de la colonne TÉCN "Técn" par coordonnées, en filtrant
//   strictement sur les lignes alignées avec une heure (pour éviter la zone INFOS)
// - la détection de la colonne CONC (durées entre dépendances) + filtrage par alignement HORA

import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"

// on aligne pdfjs sur la même méthode que tu utilises déjà côté autres parseurs
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerSrc

// ⬇️ NOUVEAU : on ne charge plus l’OCR en statique, on le chargera au moment où on en a besoin
let ocrMultiFn:
  | null
  | ((
      file: File,
      pageCount: number
    ) => Promise<{ pagesText: string[]; layout: Array<{ page: number; items: any[] }> }>) = null

// Heuristique très simple : est-ce que le texte natif PDF de cette page ressemble à quelque chose d'exploitable ?
function looksUsable(raw: string): boolean {
  // Est-ce qu'on voit un PK genre "621.0" ou "752.4" ?
  const hasPk = /\b\d{3,}\.\d\b/.test(raw)
  // Est-ce qu'on voit un nom de dépendance/gare/bif ?
  const hasDep = /\b(BIF\.|FIGUERES|GIRONA|MOLLET|SANTS|LIMITE|ADIF|LFPSA|VILAFANT)\b/i.test(raw)
  return hasPk && hasDep
}

async function extractAllPagesPdfText(pdf: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .filter((it: any): it is TextItem => !!(it as TextItem).str)
      .map((ti: TextItem) => ti.str)
      .join(" ")
    out.push(pageText)
  }

  return out
}

/**
 * Un code COM/TECN/CONC valide (durée d'arrêt / intervalle en minutes) :
 * - 1 ou 2 chiffres (0 à 59)
 *
 * ⚠️ On accepte désormais 0 et 1.
 * Le filtrage du bruit se fait par :
 * - la bande horizontale (COM / TECN / CONC),
 * - l'alignement vertical avec une HORA.
 *
 * En OCR, les nombres peuvent être très pollués :
 *   "7.", " 7,", "(5", "5)", "3º", "  6 "
 * Au lieu d'essayer de gérer tous les cas un par un,
 * on fait une normalisation "forte" :
 *   - on enlève TOUT ce qui n'est pas un chiffre (0–9)
 *   - on vérifie que le résultat est 1 ou 2 chiffres, 0–59.
 */
function isComCodeToken(token: string): boolean {
  if (token == null) return false

  // Nettoyage agressif : on ne garde que les chiffres
  let s = token.toString().trim().replace(/\D/g, "")

  // Rien ou trop de chiffres => pas une durée simple en minutes
  if (!/^\d{1,2}$/.test(s)) return false

  const n = Number(s)
  if (!Number.isFinite(n)) return false
  if (n >= 60) return false // pas une durée réaliste ici

  return true
}

async function handleFileFT(file: File) {
  // 1. Charger le PDF
  const ab = await file.arrayBuffer()
  const pdf: PDFDocumentProxy = await pdfjsLib.getDocument({ data: ab }).promise

  // Helper local: extrait, pour chaque page, la liste détaillée des items texte avec position
  async function extractTextItemsAllPages(pdf: PDFDocumentProxy) {
    const pages: Array<{
      page: number
      items: Array<{
        str: string
        x: number
        y: number
        w: number
        h: number
        dir?: string
        fontName?: string
      }>
    }> = []

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const tc = await page.getTextContent()
      const items = (tc.items as any[]).map((it: any) => {
        const tr = Array.isArray(it.transform) ? it.transform : [1, 0, 0, 1, 0, 0]
        const x = Number(tr[4]) || 0
        const y = Number(tr[5]) || 0
        const w = typeof it.width === "number" ? it.width : 0
        const h = typeof it.height === "number" ? it.height : 0
        return {
          str: String(it.str ?? ""),
          x,
          y,
          w,
          h,
          dir: it.dir,
          fontName: it.fontName,
        }
      })
      pages.push({ page: pageNum, items })
    }
    return pages
  }

  // 2. Récup texte PDF natif pour toutes les pages
  const pdfTexts = await extractAllPagesPdfText(pdf)

  // 3. Récup OCR Vision multi-pages (texte + layout) — mais en lazy + tolérant
  //
  // pagesText = texte brut par page (normalisé)
  // ocrLayout = [{ page, items:[{ text, x, y, w, h }, ...] }, ...]
  let ocrPagesText: string[] = Array(pdf.numPages).fill("")
  let ocrLayout: Array<{ page: number; items: any[] }> = []

  try {
    if (!ocrMultiFn) {
      const mod = await import("./ocrFallback")
      ocrMultiFn = mod.ocrFallbackMultiWithLayout
    }
    const { pagesText, layout } = await ocrMultiFn(file, pdf.numPages)
    ocrPagesText = pagesText
    ocrLayout = layout
  } catch (err) {
    console.warn("[ftParser] OCR indisponible en production, on reste sur le texte PDF natif.", err)
  }

  // On garde la même structure logique qu'avant : un tableau de texte OCR par page
  const ocrPagesGuess = ocrPagesText

  // 4. Choisir, page par page, la meilleure source (PDF natif vs OCR)
  const mergedPerPage: Array<{
    page: number
    mode: "pdf" | "ocr"
    text: string
    debug: { pdfPreview: string; ocrPreview: string }
  }> = []

  for (let i = 0; i < pdf.numPages; i++) {
    const direct = pdfTexts[i] ?? ""
    const ocrGuess = ocrPagesGuess[i] ?? ""
    const useDirect = looksUsable(direct)

    mergedPerPage.push({
      page: i + 1,
      mode: useDirect ? "pdf" : "ocr",
      text: useDirect ? direct : ocrGuess,
      debug: {
        pdfPreview: direct.slice(0, 200),
        ocrPreview: ocrGuess.slice(0, 200),
      },
    })
  }

  // 5. Stocker pour inspection manuelle si besoin
  ;(window as any).__ftLastParsedRaw = {
    pages: mergedPerPage,
    pageCount: pdf.numPages,
  }

  // 6. LOG DEBUG
  console.log(
    "[ftParser] Résumé extraction:",
    mergedPerPage.map((p) => ({ page: p.page, mode: p.mode, len: p.text.length }))
  )

  for (const p of mergedPerPage) {
    console.log(`[ftParser] --- PAGE ${p.page} (${p.mode}) ---`)
    console.log(p.text)

    // 🕐 Extraction des heures au format HH:MM
    const heures = Array.from(p.text.matchAll(/\b\d{1,2}:\d{2}\b/g)).map((m) => m[0])

    if (heures.length > 0) {
      console.log(`[ftParser] Heures détectées sur page ${p.page}:`, heures)
    } else {
      console.log(`[ftParser] Aucune heure détectée sur page ${p.page}`)
    }
  }

  // 6bis. Aperçu du texte brut par page (limité à 500 caractères)
  for (const p of mergedPerPage) {
    console.log(`[ftParser] --- PAGE ${p.page} (${p.mode}) ---`)
    console.log(p.text.slice(0, 500))
  }

  // 7. Émettre l'event vers le front (texte brut/choisi)
  window.dispatchEvent(
    new CustomEvent("ft:parsedRaw", {
      detail: {
        pages: mergedPerPage,
        pageCount: pdf.numPages,
      },
    })
  )

  // 8. Émettre l'event des heures agrégées (identique à avant)
  const heuresByPage: Array<{ page: number; mode: string; heures: string[] }> = []
  for (const p of mergedPerPage) {
    const heures = Array.from(p.text.matchAll(/\b\d{1,2}:\d{2}\b/g)).map((m) => m[0])
    heuresByPage.push({ page: p.page, mode: p.mode, heures })
  }
  window.dispatchEvent(
    new CustomEvent("ft:heures", {
      detail: { byPage: heuresByPage },
    })
  )

  // 9. ➜ items texte avec positions (pour détecter les colonnes par alignement – PDF ou OCR Vision)
  const textItemsPages = await extractTextItemsAllPages(pdf)
  ;(window as any).__ftLastTextItems = { pages: textItemsPages, pageCount: pdf.numPages }
  console.log("[ftParser] textItems dump:", {
    pageCount: pdf.numPages,
    sample: textItemsPages[0]?.items?.slice(0, 10) ?? [],
  })

  window.dispatchEvent(
    new CustomEvent("ft:textItems", {
      detail: {
        pages: textItemsPages, // [{ page?, items:[{str,x,y,w,h,...}]}]
        pageCount: pdf.numPages,
      },
    })
  )

  // =====================================================================
  // 10. Détection colonne C ("Com"), TÉCN ("Técn") et CONC par coordonnées
  //     + association COM ↔ HORA
  //
  // - COM : bande entre Dependencia et Hora + association COM ↔ HORA
  // - TÉCN : bande entre Hora et Conc, filtrée par alignement avec HORA
  // - CONC : bande entre Técn et Radio, filtrée par alignement avec HORA
  // =====================================================================

  type TI = { str: string; x: number; y: number; w: number; h: number }

  // Normalisation robuste des tokens d'en-tête :
  // - minuscule
  // - suppression des accents (é → e)
  // - suppression de la ponctuation / chiffres
  // - remplacement "rn" → "m" pour gérer le cas "Corn" → "Com"
  function normalizeHeaderToken(raw: string): string {
    return (raw ?? "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, "")
      .replace(/rn/g, "m")
  }

  const matchHeader = (s: string) => {
    const n = normalizeHeaderToken(s)
    return (
      n === "bloqueo" ||
      n === "dependencia" ||
      n === "com" ||
      n === "hora" ||
      n === "tecn" ||
      n === "conc" ||
      n === "radio" ||
      n === "ramp" ||
      n === "caract" ||
      n === "nivel"
    )
  }

  function centerX(it: Partial<TI>) {
    const x = Number((it as any).x) || 0
    const w = Number((it as any).w) || 0
    return x + w / 2
  }

  function findHeaders(items: TI[]) {
    const headers = {
      bloqueo: [] as TI[],
      dependencia: [] as TI[],
      com: [] as TI[],
      hora: [] as TI[],
      tecn: [] as TI[],
      conc: [] as TI[],
      radio: [] as TI[],
    }

    for (const it of items) {
      const raw = (it.str ?? "").toString().trim()
      if (!raw) continue
      const n = normalizeHeaderToken(raw)

      if (n === "bloqueo") headers.bloqueo.push(it)
      else if (n === "dependencia") headers.dependencia.push(it)
      else if (n === "com") headers.com.push(it)
      else if (n === "hora") headers.hora.push(it)
      else if (n === "tecn") headers.tecn.push(it)
      else if (n === "conc") headers.conc.push(it)
      else if (n === "radio" || n === "ra" || n === "dio") headers.radio.push(it)
    }

    return headers
  }

  function bestByWidth(arr: TI[]) {
    if (!arr.length) return null
    let best: TI = arr[0]
    for (const it of arr) if ((it.w || 0) > (best.w || 0)) best = it
    return best
  }

  const codesCByPage: Array<{
    page: number
    values: string[]
    headerX: number | null
    headerY: number | null
    debug: any
  }> = []

  const codesCFlat: string[] = []
  const codesCResolvedItems: Array<{ page: number; heure: string; com: string }> = []

  const concFlat: string[] = []
  const concResolvedItems: Array<{ page: number; heure: string; conc: string }> = []

  let globalComXMin: number | null = null
  let globalComXMax: number | null = null

  let globalTecnXMin: number | null = null
  let globalTecnXMax: number | null = null

  let globalConcXMin: number | null = null
  let globalConcXMax: number | null = null

  for (let i = 0; i < textItemsPages.length; i++) {
    const p = textItemsPages[i] as any
    const pageNum = Number(p.page) || i + 1

    const meta = mergedPerPage[pageNum - 1]
    const mode = meta?.mode ?? "pdf"

    let usedOcrLayout = false

    let items: TI[] = []

    if (mode === "pdf") {
      items = Array.isArray(p.items) ? (p.items as TI[]) : []

      if (!items.length && Array.isArray(ocrLayout)) {
        const ocrPage = (ocrLayout as any).find((op: any) => Number(op.page) === pageNum)
        if (ocrPage && Array.isArray(ocrPage.items) && ocrPage.items.length) {
          items = (ocrPage.items as any[]).map((w: any) => ({
            str: String(w.text ?? ""),
            x: Number(w.x) || 0,
            y: Number(w.y) || 0,
            w: Number(w.w) || 0,
            h: Number(w.h) || 0,
          }))
          usedOcrLayout = true
          console.warn(
            `[ftParser] COM/TECN(page ${pageNum}): fallback sur layout OCR (mode=pdf, items=${items.length})`
          )
        }
      }
    } else {
      if (Array.isArray(ocrLayout)) {
        const ocrPage = (ocrLayout as any).find((op: any) => Number(op.page) === pageNum)
        if (ocrPage && Array.isArray(ocrPage.items) && ocrPage.items.length) {
          items = (ocrPage.items as any[]).map((w: any) => ({
            str: String(w.text ?? ""),
            x: Number(w.x) || 0,
            y: Number(w.y) || 0,
            w: Number(w.w) || 0,
            h: Number(w.h) || 0,
          }))
          usedOcrLayout = true
          console.warn(
            `[ftParser] COM/TECN(page ${pageNum}): mode=ocr -> usage direct layout OCR (items=${items.length})`
          )
        }
      }
    }

    if (!items.length) {
      console.log(`[ftParser] COM/TECN(page ${pageNum}) ignorée (mode=${mode}, items=${items.length})`)
      codesCByPage.push({
        page: pageNum,
        values: [],
        headerX: null,
        headerY: null,
        debug: { reason: "no-items", mode, itemsCount: items.length },
      })
      continue
    }

    const debugTokens = items
      .filter((it) => {
        const s = (it.str || "").toString()
        return matchHeader(s) || isComCodeToken(s)
      })
      .slice(0, 40)
      .map((it) => ({ s: it.str, x: it.x, y: it.y, w: it.w }))

    const headers = findHeaders(items)
    const hDep = bestByWidth(headers.dependencia)
    const hCom = bestByWidth(headers.com)
    const hHora = bestByWidth(headers.hora)
    const hTecn = bestByWidth(headers.tecn)
    const hConc = bestByWidth(headers.conc)
    const hRadio = bestByWidth(headers.radio)

    console.log(`[ftParser] Headers(page ${pageNum})`, {
      found: {
        dependencia: !!hDep,
        com: !!hCom,
        hora: !!hHora,
        tecn: !!hTecn,
        conc: !!hConc,
        radio: !!hRadio,
      },
      candidates: {
        dependencia: headers.dependencia.length,
        com: headers.com.length,
        hora: headers.hora.length,
        tecn: headers.tecn.length,
        conc: headers.conc.length,
        radio: headers.radio.length,
      },
      sample: debugTokens,
    })

    let yHeader: number | null = null
    const headerYs: number[] = []
    if (hDep) headerYs.push(Number(hDep.y) || 0)
    if (hCom) headerYs.push(Number(hCom.y) || 0)
    if (hHora) headerYs.push(Number(hHora.y) || 0)
    if (hTecn) headerYs.push(Number(hTecn.y) || 0)
    if (hConc) headerYs.push(Number(hConc.y) || 0)
    if (headerYs.length > 0) {
      yHeader = Math.min(...headerYs)
    }

    // --- Bande COM : entre fin "Dependencia" et début "Hora" ---
    let depEndX: number | null = null
    let horaStartX: number | null = null
    let headerComX: number | null = null

    if (hDep && hCom && hHora) {
      depEndX = (Number(hDep.x) || 0) + (Number(hDep.w) || 0)
      horaStartX = Number(hHora.x) || 0
      headerComX = centerX(hCom)

      if (!(depEndX < horaStartX)) {
        console.warn(
          `[ftParser] COM(page ${pageNum}): bornes horizontales incohérentes depEndX=${depEndX} horaStartX=${horaStartX}`
        )
        codesCByPage.push({
          page: pageNum,
          values: [],
          headerX: headerComX,
          headerY: yHeader,
          debug: { depEndX, horaStartX, sample: debugTokens },
        })
        continue
      }

      globalComXMin = depEndX
      globalComXMax = horaStartX
    } else if (globalComXMin != null && globalComXMax != null) {
      depEndX = globalComXMin
      horaStartX = globalComXMax
      headerComX = (globalComXMin + globalComXMax) / 2
      console.warn(
        `[ftParser] COM(page ${pageNum}): pas d'en-têtes complets -> réutilisation de la zone globale [${globalComXMin.toFixed(
          1
        )} ; ${globalComXMax.toFixed(1)}]`
      )
    } else {
      console.warn(
        `[ftParser] COM(page ${pageNum}): en-têtes Dependencia/Com/Hora incomplets et aucune bande globale -> aucune valeur`
      )
      codesCByPage.push({
        page: pageNum,
        values: [],
        headerX: null,
        headerY: yHeader,
        debug: { headers, sample: debugTokens },
      })
      continue
    }

    // --- Bande TÉCN : entre fin "Hora" et début "Conc" ---
    let tecnXMin: number | null = null
    let tecnXMax: number | null = null
    let headerTecnX: number | null = null

    if (hHora && hTecn && hConc) {
      const horaEndX = (Number(hHora.x) || 0) + (Number(hHora.w) || 0)
      const concStartX = Number(hConc.x) || 0
      headerTecnX = centerX(hTecn)

      if (horaEndX < concStartX) {
        tecnXMin = horaEndX
        tecnXMax = concStartX
        globalTecnXMin = tecnXMin
        globalTecnXMax = tecnXMax
      } else {
        console.warn(
          `[ftParser] TECN(page ${pageNum}): bornes horizontales incohérentes horaEndX=${horaEndX} concStartX=${concStartX}`
        )
      }
    } else if (globalTecnXMin != null && globalTecnXMax != null) {
      tecnXMin = globalTecnXMin
      tecnXMax = globalTecnXMax
      headerTecnX = (globalTecnXMin + globalTecnXMax) / 2
      console.warn(
        `[ftParser] TECN(page ${pageNum}): pas d'en-têtes complets -> réutilisation de la zone globale [${globalTecnXMin.toFixed(
          1
        )} ; ${globalTecnXMax.toFixed(1)}]`
      )
    } else {
      console.warn(
        `[ftParser] TECN(page ${pageNum}): en-têtes Hora/Tecn/Conc incomplets et aucune bande globale -> aucune valeur`
      )
    }

    // --- Bande CONC : entre fin "Técn" et début "Radio" ---
    let concXMin: number | null = null
    let concXMax: number | null = null

    if (hTecn && hConc && hRadio) {
      const tecnEndX = (Number(hTecn.x) || 0) + (Number(hTecn.w) || 0)
      const radioStartX = Number(hRadio.x) || 0

      if (tecnEndX < radioStartX) {
        concXMin = tecnEndX
        concXMax = radioStartX
        globalConcXMin = concXMin
        globalConcXMax = concXMax
      } else {
        console.warn(
          `[ftParser] CONC(page ${pageNum}): bornes horizontales incohérentes tecnEndX=${tecnEndX} radioStartX=${radioStartX}`
        )
      }
    } else if (globalConcXMin != null && globalConcXMax != null) {
      concXMin = globalConcXMin
      concXMax = globalConcXMax
      console.warn(
        `[ftParser] CONC(page ${pageNum}): pas d'en-têtes complets -> réutilisation de la zone globale [${globalConcXMin.toFixed(
          1
        )} ; ${globalConcXMax.toFixed(1)}]`
      )
    } else {
      console.warn(
        `[ftParser] CONC(page ${pageNum}): en-têtes Tecn/Conc/Radio incomplets et aucune bande globale -> bande non définie`
      )
    }

    if (concXMin != null && concXMax != null) {
      console.log(`[ftParser] CONC(page ${pageNum}) zone [${concXMin.toFixed(1)} ; ${concXMax.toFixed(1)}]`)
    }

    const valuesCom: string[] = []
    const debugNumsCom: Array<{ val: string; xC: number; y: number }> = []
    const comCandidates: Array<{ value: string; xC: number; y: number }> = []

    const tecnCandidates: Array<{ value: string; xC: number; y: number }> = []
    const concCandidates: Array<{ value: string; xC: number; y: number }> = []

    const debugConcRawInBand: Array<{ raw: string; xC: number; y: number }> = []
    const debugConcNumericInBand: Array<{ raw: string; xC: number; y: number }> = []

    // --- 1er passage : COM ---
    for (const it of items) {
      const raw = (it.str ?? "").toString().trim()
      if (!isComCodeToken(raw)) continue

      const y = Number(it.y) || 0

      if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

      const xC = centerX(it)
      if (xC <= (depEndX as number) || xC >= (horaStartX as number)) continue

      valuesCom.push(raw)
      debugNumsCom.push({ val: raw, xC, y })
      comCandidates.push({ value: raw, xC, y })
    }

    console.log(
      `[ftParser] COM(page ${pageNum}) zone [${(depEndX as number).toFixed(
        1
      )} ; ${(horaStartX as number).toFixed(1)}] ->`,
      valuesCom
    )

    codesCByPage.push({
      page: pageNum,
      values: valuesCom,
      headerX: headerComX,
      headerY: yHeader,
      debug: {
        depEndX,
        horaStartX,
        headerX: headerComX,
        count: valuesCom.length,
        sampleNums: debugNumsCom.slice(0, 10),
        usedOcrLayout,
      },
    })
    codesCFlat.push(...valuesCom)

    // --- 1bis : TECN candidats
    if (tecnXMin != null && tecnXMax != null) {
      for (const it of items) {
        const raw = (it.str ?? "").toString().trim()
        if (!isComCodeToken(raw)) continue

        const y = Number(it.y) || 0
        if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

        const xC = centerX(it)
        if (xC <= tecnXMin || xC >= tecnXMax) continue

        tecnCandidates.push({ value: raw, xC, y })
      }
    }

    // --- 1ter : CONC candidats
    if (concXMin != null && concXMax != null) {
      for (const it of items) {
        const raw = (it.str ?? "").toString().trim()
        const y = Number(it.y) || 0

        if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

        const xC = centerX(it)

        if (xC <= concXMin || xC >= concXMax) continue

        debugConcRawInBand.push({ raw, xC, y })

        if (!isComCodeToken(raw)) continue

        concCandidates.push({ value: raw, xC, y })
        debugConcNumericInBand.push({ raw, xC, y })
      }

      console.log(`[ftParser] CONC(page ${pageNum}) debugRawInBand=`, debugConcRawInBand.slice(0, 30))
      console.log(`[ftParser] CONC(page ${pageNum}) debugNumericInBand=`, debugConcNumericInBand.slice(0, 30))
    }

    // --- 2 : heures ---
    const heureCandidates: Array<{ value: string; xC: number; y: number }> = []

    for (const it of items) {
      const raw = (it.str ?? "").toString().trim()
      if (!/\b\d{1,2}:\d{2}\b/.test(raw)) continue

      const y = Number(it.y) || 0
      if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

      const xC = centerX(it)
      if (horaStartX != null && xC <= horaStartX) continue

      heureCandidates.push({ value: raw, xC, y })
    }

    if (!heureCandidates.length) {
      if (tecnXMin != null && tecnXMax != null) {
        console.log(
          `[ftParser] TECN(page ${pageNum}) zone [${tecnXMin.toFixed(
            1
          )} ; ${tecnXMax.toFixed(1)}] -> [] (aucune heure détectée)`
        )
      }
      if (concXMin != null && concXMax != null) {
        console.log(
          `[ftParser] CONC(page ${pageNum}) zone [${concXMin.toFixed(
            1
          )} ; ${concXMax.toFixed(1)}] -> [] (aucune heure détectée)`
        )
      }
      continue
    }

    let verticalTolerance = 0

    if (heureCandidates.length >= 2) {
      const ys = heureCandidates.map((h) => h.y).sort((a, b) => a - b)
      const deltas: number[] = []
      for (let k = 1; k < ys.length; k++) {
        const d = Math.abs(ys[k] - ys[k - 1])
        if (d > 0) deltas.push(d)
      }
      if (deltas.length > 0) {
        const minDelta = Math.min(...deltas)
        verticalTolerance = minDelta / 2
      }
    }

    if (verticalTolerance <= 0) {
      verticalTolerance = 6
    }

    // --- Assoc COM ↔ HORA ---
    if (comCandidates.length && heureCandidates.length) {
      for (const com of comCandidates) {
        let bestHeure: { value: string; xC: number; y: number } | null = null
        let bestDy = Infinity

        for (const h of heureCandidates) {
          const dy = Math.abs(com.y - h.y)
          if (dy < bestDy) {
            bestDy = dy
            bestHeure = h
          }
        }

        if (!bestHeure) continue

        if (bestDy > verticalTolerance) {
          console.warn(
            `[ftParser] COM(page ${pageNum}) value=${com.value} ignoré: dy=${bestDy.toFixed(
              1
            )} > tolérance=${verticalTolerance.toFixed(1)}`
          )
          continue
        }

        codesCResolvedItems.push({
          page: pageNum,
          heure: bestHeure.value,
          com: com.value,
        })
      }
    }

    // --- TECN filtré ---
    const tecnValuesFiltered: string[] = []

    if (tecnCandidates.length && heureCandidates.length && tecnXMin != null && tecnXMax != null) {
      for (const t of tecnCandidates) {
        let bestHeure: { value: string; xC: number; y: number } | null = null
        let bestDy = Infinity

        for (const h of heureCandidates) {
          const dy = Math.abs(t.y - h.y)
          if (dy < bestDy) {
            bestDy = dy
            bestHeure = h
          }
        }

        if (!bestHeure) continue

        if (bestDy > verticalTolerance) {
          console.warn(
            `[ftParser] TECN(page ${pageNum}) value=${t.value} ignoré: dy=${bestDy.toFixed(
              1
            )} > tolérance=${verticalTolerance.toFixed(1)}`
          )
          continue
        }

        tecnValuesFiltered.push(t.value)
      }

      console.log(
        `[ftParser] TECN(page ${pageNum}) zone [${tecnXMin.toFixed(1)} ; ${tecnXMax.toFixed(1)}] ->`,
        tecnValuesFiltered
      )
    } else if (tecnXMin != null && tecnXMax != null) {
      console.log(
        `[ftParser] TECN(page ${pageNum}) zone [${tecnXMin.toFixed(1)} ; ${tecnXMax.toFixed(1)}] -> []`
      )
    }

    // --- CONC filtré ---
    const concValuesFiltered: string[] = []

    if (concCandidates.length && heureCandidates.length && concXMin != null && concXMax != null) {
      for (const c of concCandidates) {
        let bestHeure: { value: string; xC: number; y: number } | null = null
        let bestDy = Infinity

        for (const h of heureCandidates) {
          const dy = Math.abs(c.y - h.y)
          if (dy < bestDy) {
            bestDy = dy
            bestHeure = h
          }
        }

        if (!bestHeure) continue

        if (bestDy > verticalTolerance) {
          console.warn(
            `[ftParser] CONC(page ${pageNum}) value=${c.value} ignoré: dy=${bestDy.toFixed(
              1
            )} > tolérance=${verticalTolerance.toFixed(1)}`
          )
          continue
        }

        concValuesFiltered.push(c.value)
        concResolvedItems.push({
          page: pageNum,
          heure: bestHeure.value,
          conc: c.value,
        })
      }

      console.log(`[ftParser] CONC(page ${pageNum}) aligné avec HORA ->`, concValuesFiltered)
    } else if (concXMin != null && concXMax != null) {
      console.log(
        `[ftParser] CONC(page ${pageNum}) zone [${concXMin.toFixed(1)} ; ${concXMax.toFixed(1)}] -> []`
      )
    }

    concFlat.push(...concValuesFiltered)
  }

  // 11. Émettre l'event dédié à la colonne C (COM)
  window.dispatchEvent(
    new CustomEvent("ft:codesC", {
      detail: {
        byPage: codesCByPage,
        flat: codesCFlat,
      },
    })
  )

  const codesCValidation = codesCByPage.map((p) => ({
    page: p.page,
    count: p.values.length,
  }))

  window.dispatchEvent(
    new CustomEvent("ft:codesC:validation", {
      detail: {
        summary: codesCValidation,
        total: codesCFlat.length,
      },
    })
  )

  window.dispatchEvent(
    new CustomEvent("ft:codesC:resolved", {
      detail: {
        items: codesCResolvedItems,
      },
    })
  )

  window.dispatchEvent(
    new CustomEvent("ft:conc", {
      detail: {
        flat: concFlat,
      },
    })
  )

  window.dispatchEvent(
    new CustomEvent("ft:conc:resolved", {
      detail: {
        items: concResolvedItems,
      },
    })
  )
}

// branchement à l’event d’import
function setup() {
  const onImport = (e: Event) => {
    const ce = e as CustomEvent
    const file: File | undefined = ce.detail?.file
    if (file) {
      console.log("[ftParser] Reçu ft:import-pdf", file.name)
      void handleFileFT(file)
    }
  }

  window.addEventListener("ft:import-pdf", onImport as EventListener)
  console.log("[ftParser] module loaded / écoute ft:import-pdf")
}

setup()
