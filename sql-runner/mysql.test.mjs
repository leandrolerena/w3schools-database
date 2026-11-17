import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionConfig } from './mysql.mjs'

test('a statement is never split into several by MySQL: multiple statements stay off', () => {
  assert.equal(connectionConfig({ host: 'w3schools-db' }).multipleStatements, false)
  assert.equal(connectionConfig({ host: 'w3schools-db', multipleStatements: true }).multipleStatements, false)
})

test('rows come as arrays and dates and big numbers as MySQL sent them', () => {
  const config = connectionConfig({ host: 'w3schools-db', user: 'sqlrunner' })
  assert.equal(config.user, 'sqlrunner')
  assert.equal(config.rowsAsArray, true)
  assert.equal(config.dateStrings, true)
  assert.equal(config.bigNumberStrings, true)
})
