import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { parseOrigins } from './cors.mjs'
import { createHandler } from './http.mjs'

async function serve(options) {
  const calls = []
  const handler = createHandler({
    allowedOrigins: parseOrigins('http://localhost:*'),
    isReady: async () => true,
    runStatements: async (statements) => {
      calls.push(statements)
      return { results: statements.map(() => [{ affectedRows: 0 }]) }
    },
    ...options,
  })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return { url: `http://127.0.0.1:${port}`, port, calls, close: () => new Promise(resolve => server.close(resolve)) }
}

const post = (url, body, headers = {}) => fetch(`${url}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

// node:http instead of fetch, because fetch does not let a test set the Host header.
function rawRequest(port, { method = 'GET', path = '/health', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end(body)
  })
}

test('POST /run runs the statements and answers with their results', async (t) => {
  const service = await serve()
  t.after(service.close)
  const response = await post(service.url, { statements: ['SELECT 1', 'SELECT 2'] }, { Origin: 'http://localhost:3030' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3030')
  assert.deepEqual(await response.json(), { results: [[{ affectedRows: 0 }], [{ affectedRows: 0 }]] })
  assert.deepEqual(service.calls, [['SELECT 1', 'SELECT 2']])
})

test('the preflight is answered for allowed origins only', async (t) => {
  const service = await serve()
  t.after(service.close)
  const preflight = origin => fetch(`${service.url}/run`, {
    method: 'OPTIONS',
    headers: { 'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' },
  })
  const allowed = await preflight('http://localhost:3030')
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-private-network'), 'true')
  assert.equal((await preflight('https://evil.example')).status, 403)
})

test('a request from a foreign page or without JSON never runs', async (t) => {
  const service = await serve()
  t.after(service.close)
  assert.equal((await post(service.url, { statements: ['SELECT 1'] }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await post(service.url, '{"statements":["SELECT 1"]}', { 'Content-Type': 'text/plain' })).status, 415)
  assert.deepEqual(service.calls, [])
})

test('only requests addressed to localhost are served, so DNS rebinding finds nothing', async (t) => {
  const service = await serve()
  t.after(service.close)
  for (const host of [`localhost:${service.port}`, `127.0.0.1:${service.port}`, 'localhost', '[::1]:3001']) {
    assert.equal(await rawRequest(service.port, { headers: { Host: host } }), 200, host)
  }
  for (const host of ['evil.example:3001', 'localhost.evil.example', '192.168.1.20:3001']) {
    assert.equal(await rawRequest(service.port, { headers: { Host: host } }), 403, host)
  }
  const body = JSON.stringify({ statements: ['SELECT 1'] })
  assert.equal(await rawRequest(service.port, { method: 'POST', path: '/run', headers: { 'Host': 'evil.example:3001', 'Content-Type': 'application/json' }, body }), 403)
  assert.deepEqual(service.calls, [])
})

test('malformed bodies are rejected with a reason', async (t) => {
  const service = await serve()
  t.after(service.close)
  for (const body of ['{', { statements: 'SELECT 1' }, { statements: [] }, { statements: [1] }, { statements: Array(51).fill('SELECT 1') }]) {
    const response = await post(service.url, body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.ok((await response.json()).error)
  }
  assert.equal((await post(service.url, { statements: ['x'.repeat(200_000)] })).status, 413)
  assert.deepEqual(service.calls, [])
})

test('a body that keeps coming is answered with 413 once it passes the limit', async (t) => {
  const service = await serve()
  t.after(service.close)
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: service.port, method: 'POST', path: '/run', headers: { 'Content-Type': 'application/json' } },
      (response) => {
        clearInterval(feeder)
        response.resume()
        resolve(response.statusCode)
        request.destroy()
      })
    request.on('error', error => error.code === 'ECONNRESET' || error.code === 'EPIPE' ? undefined : reject(error))
    request.write('{"statements":["')
    const feeder = setInterval(() => request.write('x'.repeat(16_000)), 1)
  })
  assert.equal(status, 413)
  assert.deepEqual(service.calls, [])
})

test('until MySQL is ready the service says so instead of hanging', async (t) => {
  const service = await serve({ isReady: async () => false })
  t.after(service.close)
  const response = await post(service.url, { statements: ['SELECT 1'] })
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /startet noch/)
  assert.equal((await fetch(`${service.url}/health`)).status, 503)
})

test('blocks beyond the concurrency limit get a busy answer instead of a connection', async (t) => {
  const release = []
  const service = await serve({
    maxConcurrentRuns: 2,
    runStatements: statements => new Promise(resolve => release.push(() => resolve({ results: statements.map(() => []) }))),
  })
  t.after(service.close)
  const running = [post(service.url, { statements: ['SELECT 1'] }), post(service.url, { statements: ['SELECT 2'] })]
  while (release.length < 2) await new Promise(resolve => setTimeout(resolve, 5))
  const busy = await post(service.url, { statements: ['SELECT 3'] })
  assert.equal(busy.status, 429)
  assert.match((await busy.json()).error, /^Der SQL-Dienst führt gerade schon 2 Blöcke aus/)
  release.forEach(done => done())
  assert.deepEqual((await Promise.all(running)).map(r => r.status), [200, 200])
  const afterwards = post(service.url, { statements: ['SELECT 4'] })
  while (release.length < 3) await new Promise(resolve => setTimeout(resolve, 5))
  release[2]()
  assert.equal((await afterwards).status, 200)
})

test('a failure inside the run becomes a 500 with the message', async (t) => {
  const service = await serve({ runStatements: async () => { throw new Error('connect ECONNREFUSED') } })
  t.after(service.close)
  const response = await post(service.url, { statements: ['SELECT 1'] })
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /ECONNREFUSED/)
})

test('GET /health answers when ready, unknown paths are 404', async (t) => {
  const service = await serve()
  t.after(service.close)
  assert.deepEqual(await (await fetch(`${service.url}/health`)).json(), { ready: true })
  assert.equal((await fetch(`${service.url}/nope`)).status, 404)
})
