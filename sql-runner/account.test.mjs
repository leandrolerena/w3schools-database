import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccount } from './account.mjs'

const accessDenied = () => Object.assign(new Error("Access denied for user 'sqlrunner'@'172.18.0.3' (using password: YES)"),
  { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' })

// A MySQL whose sqlrunner password a block can change; provisioning sets it back.
function fakeMysql({ up = true } = {}) {
  const mysql = {
    up,
    passwordChanged: false,
    provisions: 0,
    logins: 0,
    async provision() {
      if (!mysql.up) throw new Error('connect ECONNREFUSED')
      mysql.provisions++
      mysql.passwordChanged = false
    },
    async login() {
      mysql.logins++
      if (!mysql.up) throw new Error('connect ECONNREFUSED')
      if (mysql.passwordChanged) throw accessDenied()
      return { close() {} }
    },
  }
  return mysql
}

test('not ready before the user is set up, ready once it is and the login works', async () => {
  const mysql = fakeMysql()
  const account = createAccount(mysql)
  assert.equal(await account.isReady(), false)
  await account.provision()
  assert.equal(await account.isReady(), true)
})

test('a changed password is set back on the next block instead of failing every block', async () => {
  const mysql = fakeMysql()
  const account = createAccount(mysql)
  await account.provision()
  mysql.passwordChanged = true
  const session = await account.open()
  assert.ok(session)
  assert.equal(mysql.provisions, 2)
})

test('the health check heals a changed password too', async () => {
  const mysql = fakeMysql()
  const account = createAccount(mysql)
  await account.provision()
  mysql.passwordChanged = true
  assert.equal(await account.isReady(), true)
  assert.equal(mysql.provisions, 2)
})

test('a flood of health checks logs in at most once per second', async () => {
  const mysql = fakeMysql()
  let now = 0
  const account = createAccount({ ...mysql, provision: mysql.provision, login: mysql.login, now: () => now })
  await account.provision()
  await Promise.all(Array.from({ length: 50 }, () => account.isReady()))
  assert.equal(mysql.logins, 1)
  now = 999
  await account.isReady()
  assert.equal(mysql.logins, 1)
  now = 1000
  await account.isReady()
  assert.equal(mysql.logins, 2)
})

test('a MySQL that is down is not ready and is not provisioned again', async () => {
  const mysql = fakeMysql()
  const account = createAccount(mysql)
  await account.provision()
  mysql.up = false
  assert.equal(await account.isReady(), false)
  await assert.rejects(account.open(), /ECONNREFUSED/)
  assert.equal(mysql.provisions, 1)
})
