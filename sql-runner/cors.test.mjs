import test from 'node:test'
import assert from 'node:assert/strict'
import { corsHeaders, parseOrigins } from './cors.mjs'

const allowed = parseOrigins('http://localhost:*, http://127.0.0.1:*,https://leandrolerena.github.io')

test('the decks on any local port and the published site are allowed', () => {
  for (const origin of ['http://localhost:3030', 'http://localhost', 'http://127.0.0.1:5173', 'https://leandrolerena.github.io']) {
    assert.equal(corsHeaders(origin, allowed)['Access-Control-Allow-Origin'], origin, origin)
  }
})

test('other origins get no CORS headers', () => {
  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'http://localhost:3030.evil.example', 'https://leandrolerena.github.io.evil.example', 'null']) {
    assert.equal(corsHeaders(origin, allowed), null, origin)
  }
})

test('the preflight answer includes the private network permission', () => {
  const headers = corsHeaders('https://leandrolerena.github.io', allowed)
  assert.equal(headers['Access-Control-Allow-Private-Network'], 'true')
  assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type')
  assert.equal(headers.Vary, 'Origin')
})
