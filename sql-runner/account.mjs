const ACCESS_DENIED = 1045

// The service's MySQL user. A block can change its password (PREPARE … SET PASSWORD);
// a refused login then sets the user up again instead of failing every later block.
// provision and login come from mysql.mjs, so the tests fake them.
// A readiness answer is reused for a second, so a flood of GET /health (which any page
// may send) costs at most one MySQL login per second.
const READY_CACHE_MS = 1000

export function createAccount({ provision, login, now = Date.now }) {
  let provisioned = false
  let lastCheck = null

  async function setUp() {
    await provision()
    provisioned = true
  }

  async function open() {
    try {
      return await login()
    }
    catch (error) {
      if (error.errno !== ACCESS_DENIED) throw error
      await setUp()
      return login()
    }
  }

  async function canLogIn() {
    try {
      (await open()).close()
      return true
    }
    catch {
      return false
    }
  }

  function isReady() {
    if (!provisioned) return Promise.resolve(false)
    if (!lastCheck || now() - lastCheck.at >= READY_CACHE_MS) lastCheck = { at: now(), answer: canLogIn() }
    return lastCheck.answer
  }

  return { provision: setUp, open, isReady }
}
