import { refusalReason } from './guard.mjs'

export const LIMITS = {
  maxRows: 1000,
  timeLimitMs: 10_000,
  maxResultSets: 20,
  maxBlockChars: 2_000_000,
}

// Runs a block's statements in order on one session and stops at the first error.
// A session is { stream(sql, handlers), killQuery(), killConnection() } (mysql.mjs),
// so the tests fake it. The result-set and character caps count over the whole block.
export async function runBlock(session, statements, limits = LIMITS) {
  const budget = { deadline: Date.now() + limits.timeLimitMs, sets: 0, chars: 0 }
  const results = []
  for (const [index, statement] of statements.entries()) {
    const refusal = refusalReason(statement)
    if (refusal) return { results, error: { index, code: 'REFUSED', message: refusal } }
    try {
      results.push(await runStatement(session, statement, limits, budget))
    }
    catch (error) {
      return { results, error: { index, ...describeError(error) } }
    }
  }
  return { results }
}

// The row cap ends only that query (KILL QUERY), and the next statement waits for the
// KILL, so it cannot hit the next one. Time and data caps end the connection: a
// procedure looping on SLEEP swallows KILL QUERY and would run on.
const ROW_CAP = { kill: session => session.killQuery() }

const endBlock = (code, message) => ({
  kill: session => session.killConnection(),
  error: Object.assign(new Error(message), { code }),
})

const timeUp = ({ timeLimitMs }) =>
  endBlock('TIME_LIMIT', `Abgebrochen nach ${timeLimitMs / 1000} Sekunden: Die Anweisung lief zu lange.`)

const tooMuchData = ({ maxResultSets, maxBlockChars }) => endBlock('TOO_MUCH_DATA',
  `Abgebrochen: Der Block liefert zu viele Daten (höchstens ${maxResultSets} Ergebnistabellen und ${charLimitText(maxBlockChars)} pro Block).`)

const charLimitText = chars => chars >= 1_000_000 ? `${chars / 1_000_000} MB` : `${chars} Zeichen`

function runStatement(session, sql, limits, budget) {
  return new Promise((resolve, reject) => {
    const sets = []
    let stopped = null
    let killing = Promise.resolve()
    // A row-capped statement can still loop on (SLEEP swallows the KILL QUERY), so a
    // reason that ends the block overrides the row cap.
    const stop = (reason) => {
      if (stopped?.error || (stopped && !reason.error)) return
      stopped = reason
      killing = Promise.resolve().then(() => reason.kill(session)).catch(() => {})
      if (reason.error) killing.then(() => reject(reason.error))
    }
    const timer = setTimeout(() => stop(timeUp(limits)), Math.max(0, budget.deadline - Date.now()))
    const settle = (outcome) => {
      clearTimeout(timer)
      killing.then(outcome)
    }
    session.stream(sql, {
      fields: (columns) => {
        if (stopped) return
        if (++budget.sets > limits.maxResultSets) return stop(tooMuchData(limits))
        sets.push({ columns, rows: [], more: false })
      },
      row: (values) => {
        if (stopped) return
        const reason = addRow(sets.at(-1), values, limits, budget)
        if (reason) stop(reason)
      },
      header: ({ affectedRows }) => stopped || sets.push({ affectedRows }),
      end: () => settle(() => resolve(sets)),
      error: error => settle(() => {
        if (stopped?.error) reject(stopped.error)
        else if (stopped) resolve(sets)
        else reject(error)
      }),
    })
  })
}

// Returns why the statement has to stop, or nothing.
function addRow(set, values, limits, budget) {
  if (set.rows.length === limits.maxRows) {
    set.more = true
    return ROW_CAP
  }
  const cells = values.map(cellText)
  budget.chars += cells.reduce((sum, cell) => sum + (cell?.length ?? 0), 0)
  if (budget.chars > limits.maxBlockChars) return tooMuchData(limits)
  set.rows.push(cells)
  return null
}

// MySQL's errors read as in the mysql client: ERROR 1146 (42S02): Table … doesn't exist
function describeError(error) {
  if (error.sqlMessage) return { code: error.code, message: `ERROR ${error.errno} (${error.sqlState}): ${error.sqlMessage}` }
  return { code: error.code ?? 'ERROR', message: error.message }
}

export function cellText(value) {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
