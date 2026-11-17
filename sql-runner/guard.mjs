// Statements that would leave the teaching database broken for the next exercise, or that
// reach past it. The MySQL user's privileges are the boundary; this gives the clear reason.
const REFUSED = [
  [/\b(CREATE|DROP|ALTER)\s+(DATABASE|SCHEMA)\b/i, 'Datenbanken anlegen, ändern oder löschen geht über die Folien nicht, damit w3schools für die nächste Übung erhalten bleibt. Im MySQL-Client der VM geht es.'],
  [/\b(CREATE|DROP|ALTER|RENAME)\s+USER\b|\bGRANT\b|\bREVOKE\b|\bSET\s+PASSWORD\b/i, 'Benutzer und Rechte verwaltest Du nicht über die Folien, sondern als root im MySQL-Client der VM.'],
  [/\bLOAD\s+(DATA|XML)\b|\bINTO\s+(OUTFILE|DUMPFILE)\b|\bLOAD_FILE\s*\(/i, 'Dateien lesen und schreiben geht über die Folien nicht.'],
  [/\b(LOCK|UNLOCK)\s+TABLES?\b|\bKILL\b|\bSHUTDOWN\b|\bFLUSH\b|\bSET\s+GLOBAL\b|\bINSTALL\s+PLUGIN\b/i, 'Den MySQL-Server steuern (Sperren, KILL, SHUTDOWN, globale Einstellungen) geht über die Folien nicht.'],
]

// Strings, identifiers in backticks and comments blanked out; MySQL runs the content of
// /*! … */ comments, so only their opening marker goes.
const NON_CODE = /'(?:\\.|''|[^'\\])*'?|"(?:\\.|""|[^"\\])*"?|`[^`]*`?|\/\*!\d*|\/\*[\s\S]*?(?:\*\/|$)|(?:--\s|#)[^\n]*/g

const codeOnly = statement => statement.replace(NON_CODE, ' ')

export function refusalReason(statement) {
  const code = codeOnly(statement)
  return REFUSED.find(([pattern]) => pattern.test(code))?.[1] ?? null
}
