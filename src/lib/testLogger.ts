// src/lib/testLogger.ts

export type TestLogEvent = {
  t: string;        // horodatage ISO
  kind: string;     // type d'événement (ex: 'gps:projected', 'ft:active-row')
  payload?: any;    // données associées (objet sérialisable)
}

let isRecording = false
let currentSessionId: string | null = null
let events: TestLogEvent[] = []

/**
 * Indique si un test est en cours d'enregistrement.
 */
export function isTestRecording(): boolean {
  return isRecording
}

/**
 * Démarre une nouvelle session de test.
 * - Réinitialise le buffer d'événements.
 * - Marque l'enregistreur comme "actif".
 */
export function startTestSession(label?: string): void {
  const now = new Date()
  const iso = now.toISOString().replace(/[:.]/g, '-')

  // id de session simple : YYYY-MM-DDTHH-MM-SS-sss + label optionnel
  currentSessionId = label
    ? `${iso}_${sanitizeLabel(label)}`
    : iso

  events = []
  isRecording = true

  // on loggue un événement spécial "start"
  logTestEvent('session:start', {
    sessionId: currentSessionId,
    label: label ?? null,
  })
}

/**
 * Arrête la session de test en cours.
 * (n'efface pas les événements : on peut encore les exporter après)
 */
export function stopTestSession(): void {
  if (!isRecording) return

  logTestEvent('session:stop', {
    sessionId: currentSessionId,
  })

  isRecording = false
}

/**
 * Ajoute un événement dans le log si une session est active.
 */
export function logTestEvent(kind: string, payload?: any): void {
  if (!isRecording) return

  const evt: TestLogEvent = {
    t: new Date().toISOString(),
    kind,
    payload,
  }

  events.push(evt)
}

/**
 * Retourne une copie des événements courants (pour debug éventuel).
 */
export function getCurrentTestEvents(): TestLogEvent[] {
  return [...events]
}

/**
 * Exporte le log courant dans un fichier .log (texte brut).
 * - Retourne true si un fichier a été déclenché.
 * - Retourne false si aucun événement n'est disponible.
 */
export function exportTestLog(): boolean {
  if (events.length === 0) {
    return false
  }

  const sessionId = currentSessionId ?? new Date().toISOString().replace(/[:.]/g, '-')

  const headerLines: string[] = []
  headerLines.push(`# LIM test log`)
  headerLines.push(`# sessionId=${sessionId}`)
  headerLines.push(`# startedAt=${events[0]?.t ?? ''}`)
  headerLines.push(`# endedAt=${events[events.length - 1]?.t ?? ''}`)
  headerLines.push(`# totalEvents=${events.length}`)
  headerLines.push(`# format=one-JSON-per-line (NDJSON)`)
  headerLines.push('') // ligne vide

  const bodyLines = events.map((e) => JSON.stringify(e))
  const text = headerLines.join('\n') + bodyLines.join('\n') + '\n'

  if (typeof document === 'undefined') {
    // environnement non navigateur (tests, etc.) -> pas de téléchargement
    return false
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  const filename = `LIM_testlog_${sessionId}.log`

  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return true
}

/**
 * Nettoie le label pour qu'il soit compatible avec un nom de fichier.
 */
function sanitizeLabel(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 40)
}
