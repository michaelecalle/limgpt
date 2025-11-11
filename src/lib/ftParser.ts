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
import { ocrFallbackMultiWithLayout } from "./ocrFallback"

// on aligne pdfjs sur la même méthode que tu utilises déjà côté autres parseurs
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerSrc

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

  // 3. Récup OCR Vision multi-pages (texte + layout)
  //
  // pagesText = texte brut par page (normalisé)
  // ocrLayout = [{ page, items:[{ text, x, y, w, h }, ...] }, ...]
  const { pagesText: ocrPagesText, layout: ocrLayout } =
    await ocrFallbackMultiWithLayout(file, pdf.numPages)

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

  // 6. LOG DEBUG (affichage complet pour inspection manuelle) + détection d'heures (texte brut)
  console.log(
    "[ftParser] Résumé extraction:",
    mergedPerPage.map(p => ({ page: p.page, mode: p.mode, len: p.text.length }))
  )

  for (const p of mergedPerPage) {
    console.log(`[ftParser] --- PAGE ${p.page} (${p.mode}) ---`)
    console.log(p.text)

    // 🕐 Extraction des heures au format HH:MM
    const heures = Array.from(p.text.matchAll(/\b\d{1,2}:\d{2}\b/g)).map(m => m[0])

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
    const heures = Array.from(p.text.matchAll(/\b\d{1,2}:\d{2}\b/g)).map(m => m[0])
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
      .replace(/[\u0300-\u036f]/g, "") // enlève les diacritiques
      .replace(/[^a-z]/g, "") // ne garde que les lettres
      .replace(/rn/g, "m") // OCR classique "rn" pour "m"
  }

  // Utilisé uniquement pour le debug (sélection de quelques tokens intéressants)
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

  // Détection des vrais en-têtes (bloqueo / dependencia / com / hora / técn / conc / radio)
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
      // Certains PDF écrivent "Radio" sur deux lignes: "Ra" / "dio"
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

  // toutes les valeurs CONC alignées (toutes pages confondues) pour debug
  const concFlat: string[] = []

  // correspondances CONC ↔ HORA (toutes pages confondues)
  const concResolvedItems: Array<{ page: number; heure: string; conc: string }> = []

  // Bande COM globale (entre fin "Dependencia" et début "Hora") détectée
  // sur une page avec en-têtes complets, à réutiliser pour les pages suivantes.
  let globalComXMin: number | null = null
  let globalComXMax: number | null = null

  // Bande TÉCN globale (entre fin "Hora" et début "Conc")
  let globalTecnXMin: number | null = null
  let globalTecnXMax: number | null = null

  // Bande CONC globale (entre fin "Técn" et début "Radio")
  let globalConcXMin: number | null = null
  let globalConcXMax: number | null = null

  for (let i = 0; i < textItemsPages.length; i++) {
    const p = textItemsPages[i] as any
    const pageNum = Number(p.page) || i + 1

    const meta = mergedPerPage[pageNum - 1]
    const mode = meta?.mode ?? "pdf"

    // Flag: est-ce qu'on a dû basculer sur le layout OCR (Google Vision) ?
    let usedOcrLayout = false

    let items: TI[] = []

    if (mode === "pdf") {
      // Cas normal : on fait confiance à la couche texte PDF
      items = Array.isArray(p.items) ? (p.items as TI[]) : []

      // Petit filet de sécurité : si vraiment rien, on tente le layout OCR
      if (!items.length && Array.isArray((ocrLayout as any))) {
        const ocrPage = (ocrLayout as any).find(
          (op: any) => Number(op.page) === pageNum
        )
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
      // mode === "ocr" : fichier scanné ou glitché -> on ignore la couche texte PDF
      // et on utilise DIRECTEMENT le layout OCR Vision pour cette page.
      if (Array.isArray((ocrLayout as any))) {
        const ocrPage = (ocrLayout as any).find(
          (op: any) => Number(op.page) === pageNum
        )
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

    // Si, même après tout ça, on n'a rien -> on abandonne pour cette page
    if (!items.length) {
      console.log(
        `[ftParser] COM/TECN(page ${pageNum}) ignorée (mode=${mode}, items=${items.length})`
      )
      codesCByPage.push({
        page: pageNum,
        values: [],
        headerX: null,
        headerY: null,
        debug: { reason: "no-items", mode, itemsCount: items.length },
      })
      continue
    }

    // DEBUG: quelques tokens utiles (en-têtes ou petits nombres)
    const debugTokens = items
      .filter(it => {
        const s = (it.str || "").toString()
        return matchHeader(s) || isComCodeToken(s)
      })
      .slice(0, 40)
      .map(it => ({ s: it.str, x: it.x, y: it.y, w: it.w }))

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

    // Hauteur de la ligne d'en-têtes (approx) : on prend le min des y trouvés
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
      console.log(
        `[ftParser] CONC(page ${pageNum}) zone [${concXMin.toFixed(
          1
        )} ; ${concXMax.toFixed(1)}]`
      )
    }

      const valuesCom: string[] = []
    const debugNumsCom: Array<{ val: string; xC: number; y: number }> = []
    const comCandidates: Array<{ value: string; xC: number; y: number }> = []

    const tecnCandidates: Array<{ value: string; xC: number; y: number }> = []
    const concCandidates: Array<{ value: string; xC: number; y: number }> = []

    // Debug spécifique colonne CONC : tout ce qui tombe dans la bande X, avant/après filtrage numérique
    const debugConcRawInBand: Array<{ raw: string; xC: number; y: number }> = []
    const debugConcNumericInBand: Array<{ raw: string; xC: number; y: number }> = []


    // --- 1er passage : détection des COM dans la bande horizontale ---
    for (const it of items) {
      const raw = (it.str ?? "").toString().trim()
      if (!isComCodeToken(raw)) continue

      const y = Number(it.y) || 0

      // Si on connaît la hauteur de la ligne d'en-têtes, on ne garde que ce qui est en-dessous.
      // PDF classique: plus on descend, plus y diminue.
      // OCR (usedOcrLayout = true): les coordonnées sont différentes, on ne filtre PAS par Y,
      // on se repose uniquement sur la bande horizontale.
      if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

      const xC = centerX(it)
      // Zone horizontale stricte : entre fin "Dependencia" et début "Hora"
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

    // --- 1bis : détection des TÉCN dans la bande Hora–Conc (candidats bruts) ---
    if (tecnXMin != null && tecnXMax != null) {
      for (const it of items) {
        const raw = (it.str ?? "").toString().trim()
        if (!isComCodeToken(raw)) continue

        const y = Number(it.y) || 0
        if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

        const xC = centerX(it)
        if (xC <= tecnXMin || xC >= tecnXMax) continue

        // Candidat TECN brut — sera filtré par alignement avec une heure
        tecnCandidates.push({ value: raw, xC, y })
      }
    }

    // --- 1ter : détection des CONC dans la bande Tecn–Radio (candidats bruts) ---
    if (concXMin != null && concXMax != null) {
      for (const it of items) {
        const raw = (it.str ?? "").toString().trim()
        const y = Number(it.y) || 0

        // Filtrage vertical : seulement pour le PDF natif ; en OCR (usedOcrLayout=true) on ne filtre pas par yHeader.
        if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

        const xC = centerX(it)

        // On ne s'intéresse qu'aux items dans la bande X CONC
        if (xC <= concXMin || xC >= concXMax) continue

        // Debug : on loggue tout ce qui tombe dans la bande, même si ce n'est pas un nombre propre
        debugConcRawInBand.push({ raw, xC, y })

        // Candidat numérique CONC brut — sera filtré par alignement avec une heure
        if (!isComCodeToken(raw)) continue

        concCandidates.push({ value: raw, xC, y })
        debugConcNumericInBand.push({ raw, xC, y })
      }

      // Petit log debug pour comprendre ce que voit l'OCR dans la bande CONC
      console.log(
        `[ftParser] CONC(page ${pageNum}) debugRawInBand=`,
        debugConcRawInBand.slice(0, 30)
      )
      console.log(
        `[ftParser] CONC(page ${pageNum}) debugNumericInBand=`,
        debugConcNumericInBand.slice(0, 30)
      )
    }


    // --- 2e passage : détection des HEURES dans la colonne Hora ---
    const heureCandidates: Array<{ value: string; xC: number; y: number }> = []

    for (const it of items) {
      const raw = (it.str ?? "").toString().trim()
      if (!/\b\d{1,2}:\d{2}\b/.test(raw)) continue

      const y = Number(it.y) || 0
      if (!usedOcrLayout && yHeader != null && y >= yHeader) continue

      const xC = centerX(it)
      // On considère que la colonne Hora est à droite de horaStartX.
      if (horaStartX != null && xC <= horaStartX) continue

      heureCandidates.push({ value: raw, xC, y })
    }

    // Si pas d'heures, on ne peut pas faire d'association fine
    if (!heureCandidates.length) {
      // On log quand même TECN/CONC, mais la liste sera vide car aucune heure ne permet de valider les candidats.
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

    // --- Estimation d'une hauteur de ligne moyenne pour fixer une tolérance Y ---
    let verticalTolerance = 0

    if (heureCandidates.length >= 2) {
      const ys = heureCandidates.map(h => h.y).sort((a, b) => a - b)
      const deltas: number[] = []
      for (let k = 1; k < ys.length; k++) {
        const d = Math.abs(ys[k] - ys[k - 1])
        if (d > 0) deltas.push(d)
      }
      if (deltas.length > 0) {
        const minDelta = Math.min(...deltas)
        // tolérance: environ la moitié de l'écart vertical moyen entre deux lignes d'heure
        verticalTolerance = minDelta / 2
      }
    }

    // Si on n'a rien pu estimer, on met un petit plancher fixe (coordonnées OCR ~pixels)
    if (verticalTolerance <= 0) {
      verticalTolerance = 6 // valeur prudente: petite tolérance
    }

    // --- Association COM ↔ HORA (même page) ---
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

        // On n'accepte que les heures vraiment proches en Y
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

    // --- Filtrage TECN ↔ HORA : on ne garde que les TECN alignés avec une heure ---
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

        // ❗ Cœur de la protection contre le "20" de la date :
        // On n'accepte le TECN que s'il est vraiment sur la même ligne que l'heure.
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
        `[ftParser] TECN(page ${pageNum}) zone [${tecnXMin.toFixed(
          1
        )} ; ${tecnXMax.toFixed(1)}] ->`,
        tecnValuesFiltered
      )
    } else if (tecnXMin != null && tecnXMax != null) {
      // Bande connue mais aucun candidat -> log vide
      console.log(
        `[ftParser] TECN(page ${pageNum}) zone [${tecnXMin.toFixed(
          1
        )} ; ${tecnXMax.toFixed(1)}] -> []`
      )
    }

    // --- Filtrage CONC ↔ HORA : mêmes règles que TECN ---
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

        // Une valeur CONC n'est valide que si elle est bien alignée avec une heure
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

      console.log(
        `[ftParser] CONC(page ${pageNum}) aligné avec HORA ->`,
        concValuesFiltered
      )
    } else if (concXMin != null && concXMax != null) {
      console.log(
        `[ftParser] CONC(page ${pageNum}) zone [${concXMin.toFixed(
          1
        )} ; ${concXMax.toFixed(1)}] -> []`
      )
    }

    // on accumule toutes les valeurs CONC filtrées pour debug global
    concFlat.push(...concValuesFiltered)
  }

  // 11. Émettre l'event dédié à la colonne C (COM) — brut (par page + flat)
  window.dispatchEvent(
    new CustomEvent("ft:codesC", {
      detail: {
        byPage: codesCByPage, // [{page, values:[...], headerX, headerY, debug}]
        flat: codesCFlat, // concat de toutes les pages
      },
    })
  )

  // 11bis. Émettre un event de validation simple sur les codes C (optionnel)
  const codesCValidation = codesCByPage.map(p => ({
    page: p.page,
    count: p.values.length,
  }))

  window.dispatchEvent(
    new CustomEvent("ft:codesC:validation", {
      detail: {
        summary: codesCValidation, // [{ page, count }]
        total: codesCFlat.length, // nombre total de valeurs C toutes pages confondues
      },
    })
  )

  // 11ter. Émettre les codes C résolus avec leur heure -> utilisable par FT.tsx
  // FT.tsx a déjà un listener ft:codesC:resolved qui remplit codesCParHeure[heure] = [COM...]
  window.dispatchEvent(
    new CustomEvent("ft:codesC:resolved", {
      detail: {
        items: codesCResolvedItems, // [{ page, heure, com }]
      },
    })
  )

  // 11quater. Event debug pour la colonne CONC (valeurs alignées avec HORA, toutes pages)
  window.dispatchEvent(
    new CustomEvent("ft:conc", {
      detail: {
        flat: concFlat,
      },
    })
  )

  // 11quinquies. Event complet CONC ↔ HORA (toutes pages)
  window.dispatchEvent(
    new CustomEvent("ft:conc:resolved", {
      detail: {
        items: concResolvedItems, // [{ page, heure, conc }]
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
