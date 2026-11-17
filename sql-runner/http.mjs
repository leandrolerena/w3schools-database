import { corsHeaders } from './cors.mjs'

export const MAX_STATEMENTS = 50
const MAX_BODY_BYTES = 100_000
const NOT_READY = 'MySQL in der VM startet noch. Versuche es in ein paar Sekunden noch einmal.'

// Each block holds a MySQL connection (two while a KILL runs); the cap keeps a flood of
// requests from taking MySQL's connections away from the REST API.
const MAX_CONCURRENT_RUNS = 8

// Only names of this computer: a page on another domain that resolves to 127.0.0.1
// (DNS rebinding) sends its own name as Host.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Requests from a page whose origin is not allowed never run: a browser sends Origin on
// every cross-origin call, and a JSON body always needs the preflight.
export function createHandler({ allowedOrigins, isReady, runStatements, maxConcurrentRuns = MAX_CONCURRENT_RUNS }) {
  const runLimited = limitConcurrency(runStatements, maxConcurrentRuns)
  return async (request, response) => {
    const cors = corsHeaders(request.headers.origin, allowedOrigins)
    const reply = (status, body) => send(response, status, body, cors)
    if (!LOCAL_HOST.test(request.headers.host ?? '')) return reply(403, { error: 'Der SQL-Dienst antwortet nur unter localhost.' })
    if (request.headers.origin && !cors) return reply(403, { error: 'Diese Seite darf den SQL-Dienst nicht verwenden.' })
    try {
      const [status, body] = await route(request, { isReady, runStatements: runLimited })
      reply(status, body)
    }
    catch (error) {
      reply(error.status ?? 500, { error: error.message })
    }
  }
}

function limitConcurrency(run, max) {
  let running = 0
  return async (statements) => {
    if (running >= max) throw new HttpError(429, `Der SQL-Dienst führt gerade schon ${max} Blöcke aus. Versuche es in ein paar Sekunden noch einmal.`)
    running++
    try {
      return await run(statements)
    }
    finally {
      running--
    }
  }
}

async function route(request, { isReady, runStatements }) {
  const path = new URL(request.url, 'http://localhost').pathname
  if (request.method === 'OPTIONS') return [204]
  if (request.method === 'GET' && path === '/health') return await isReady() ? [200, { ready: true }] : [503, { ready: false, error: NOT_READY }]
  if (request.method === 'POST' && path === '/run') return [200, await runStatements(await statementsOf(request, isReady))]
  throw new HttpError(404, 'Unbekannte Adresse. Der Dienst kennt POST /run und GET /health.')
}

async function statementsOf(request, isReady) {
  if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'Erwartet wird Content-Type: application/json.')
  if (!await isReady()) throw new HttpError(503, NOT_READY)
  return validStatements(parseJson(await readBody(request)))
}

const tooLarge = () => new HttpError(413, `Der Block ist zu gross (höchstens ${MAX_BODY_BYTES / 1000} kB).`)

// Reading stops at the limit; the 413 then closes the connection with the rest unread.
function readBody(request) {
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) return Promise.reject(tooLarge())
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const onData = (chunk) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) return chunks.push(chunk)
      request.off('data', onData)
      request.pause()
      reject(tooLarge())
    }
    request.on('data', onData)
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  }
  catch {
    throw new HttpError(400, 'Der Inhalt ist kein gültiges JSON.')
  }
}

function validStatements(body) {
  const statements = body?.statements
  if (!Array.isArray(statements) || !statements.length || !statements.every(s => typeof s === 'string')) {
    throw new HttpError(400, 'Erwartet wird {"statements": ["SELECT …", …]}.')
  }
  if (statements.length > MAX_STATEMENTS) throw new HttpError(400, `Höchstens ${MAX_STATEMENTS} Anweisungen pro Block.`)
  return statements
}

function send(response, status, body, cors) {
  response.writeHead(status, {
    ...cors,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...(status === 413 ? { Connection: 'close' } : {}),
  })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}
