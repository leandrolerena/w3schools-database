export const parseOrigins = setting => setting.split(',').map(origin => origin.trim()).filter(Boolean)

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `http://localhost:*` stands for that host on any port.
function matches(origin, pattern) {
  if (!pattern.endsWith(':*')) return origin === pattern
  return new RegExp(`^${escapeRegExp(pattern.slice(0, -2))}(:\\d+)?$`).test(origin)
}

// Chrome asks a public page for permission before it calls localhost (Private Network Access).
export function corsHeaders(origin, allowed) {
  if (!origin || !allowed.some(pattern => matches(origin, pattern))) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}
