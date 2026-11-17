import test from 'node:test'
import assert from 'node:assert/strict'
import { cellText, runBlock } from './run.mjs'

const interrupted = () => Object.assign(new Error('Query execution was interrupted'),
  { errno: 1317, sqlState: '70100', sqlMessage: 'Query execution was interrupted', code: 'ER_QUERY_INTERRUPTED' })
const connectionLost = () => Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true })

// A session that answers each statement from a script of events, like mysql2's query emitter.
// ['loop'] stands for a procedure looping on SLEEP: it never ends and swallows KILL QUERY.
function fakeSession(script) {
  const session = {
    executed: [],
    kills: { query: 0, connection: 0 },
    stream(sql, handlers) {
      session.executed.push(sql)
      const events = script[sql] ?? [['header', { affectedRows: 0 }]]
      let pending = null
      let looping = false
      let done = false
      const finish = (error) => {
        if (done) return
        done = true
        clearTimeout(pending)
        clearImmediate(pending)
        if (error) handlers.error(error)
        handlers.end()
      }
      const play = (i) => {
        if (done) return
        if (i === events.length) return finish()
        const [kind, value] = events[i]
        if (kind === 'loop') return (looping = true)
        if (kind === 'wait') return (pending = setTimeout(() => play(i + 1), value))
        if (kind === 'fail') return finish(value)
        handlers[kind](value)
        pending = setImmediate(() => play(i + 1))
      }
      session.interruptQuery = () => looping || finish(interrupted())
      session.closeConnection = () => finish(connectionLost())
      pending = setImmediate(() => play(0))
    },
    // Arrives a little late, as a KILL from a second connection does.
    async killQuery() {
      session.kills.query++
      await new Promise(resolve => setTimeout(resolve, 10))
      session.interruptQuery()
    },
    async killConnection() {
      session.kills.connection++
      session.closeConnection()
    },
  }
  return session
}

const limits = { maxRows: 3, timeLimitMs: 200, maxResultSets: 4, maxBlockChars: 100 }
const resultSets = n => Array.from({ length: n }, (_, i) => [['fields', ['i']], ['row', [i]]]).flat()

test('a result set arrives as columns and rows of text', async () => {
  const session = fakeSession({ 'SELECT 1': [['fields', ['a', 'b']], ['row', [1, null]]] })
  assert.deepEqual(await runBlock(session, ['SELECT 1'], limits),
    { results: [[{ columns: ['a', 'b'], rows: [['1', null]], more: false }]] })
})

test('a change reports the affected rows', async () => {
  const session = fakeSession({ 'DELETE FROM t': [['header', { affectedRows: 3, insertId: 0 }]] })
  assert.deepEqual(await runBlock(session, ['DELETE FROM t'], limits), { results: [[{ affectedRows: 3 }]] })
})

test('a procedure returns every result set and its closing header', async () => {
  const session = fakeSession({ 'CALL p()': [['fields', ['x']], ['row', ['1']], ['fields', ['y']], ['row', ['2']], ['header', { affectedRows: 0 }]] })
  assert.deepEqual((await runBlock(session, ['CALL p()'], limits)).results[0],
    [{ columns: ['x'], rows: [['1']], more: false }, { columns: ['y'], rows: [['2']], more: false }, { affectedRows: 0 }])
})

test('rows past the cap stop only that query and mark the result', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ['row', [i]])
  const session = fakeSession({ 'SELECT big': [['fields', ['n']], ...rows], 'SELECT 2': [['fields', ['m']], ['row', [2]]] })
  const outcome = await runBlock(session, ['SELECT big', 'SELECT 2'], limits)
  assert.deepEqual(outcome.results[0], [{ columns: ['n'], rows: [['0'], ['1'], ['2']], more: true }])
  assert.deepEqual(outcome.results[1], [{ columns: ['m'], rows: [['2']], more: false }])
  assert.deepEqual(session.kills, { query: 1, connection: 0 })
})

test('the first MySQL error stops the block and keeps the client text', async () => {
  const error = Object.assign(new Error("Table 'w3schools.Customers' doesn't exist"), { errno: 1146, sqlState: '42S02', sqlMessage: "Table 'w3schools.Customers' doesn't exist", code: 'ER_NO_SUCH_TABLE' })
  const session = fakeSession({ 'SELECT x': [['fail', error]] })
  assert.deepEqual(await runBlock(session, ['SELECT 1', 'SELECT x', 'SELECT 3'], limits), {
    results: [[{ affectedRows: 0 }]],
    error: { index: 1, code: 'ER_NO_SUCH_TABLE', message: "ERROR 1146 (42S02): Table 'w3schools.Customers' doesn't exist" },
  })
  assert.deepEqual(session.executed, ['SELECT 1', 'SELECT x'])
})

test('a refused statement never reaches MySQL', async () => {
  const session = fakeSession({})
  const outcome = await runBlock(session, ['SELECT 1', 'DROP DATABASE w3schools'], limits)
  assert.equal(outcome.error.index, 1)
  assert.equal(outcome.error.code, 'REFUSED')
  assert.deepEqual(session.executed, ['SELECT 1'])
})

test('a block past its time is ended by closing its connection, even a loop that swallows KILL QUERY', async () => {
  const session = fakeSession({ 'CALL schlafe()': [['loop']] })
  const started = Date.now()
  const outcome = await runBlock(session, ['CALL schlafe()', 'SELECT 2'], limits)
  assert.ok(Date.now() - started < 1000)
  assert.deepEqual(outcome.error, { index: 0, code: 'TIME_LIMIT', message: 'Abgebrochen nach 0.2 Sekunden: Die Anweisung lief zu lange.' })
  assert.deepEqual(session.kills, { query: 0, connection: 1 })
  assert.deepEqual(session.executed, ['CALL schlafe()'])
})

test('the time limit still ends a statement whose row cap already stopped it', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ['row', [i]])
  const session = fakeSession({ 'CALL erst_viel_dann_schlafen()': [['fields', ['n']], ...rows, ['loop']] })
  const outcome = await runBlock(session, ['CALL erst_viel_dann_schlafen()'], limits)
  assert.equal(outcome.error.code, 'TIME_LIMIT')
  assert.deepEqual(session.kills, { query: 1, connection: 1 })
})

const TOO_MUCH ='Abgebrochen: Der Block liefert zu viele Daten (höchstens 4 Ergebnistabellen und 100 Zeichen pro Block).'

test('a procedure that returns result sets without end is stopped at the set cap', async () => {
  const session = fakeSession({ 'CALL zaehle()': [...resultSets(50), ['loop']] })
  const outcome = await runBlock(session, ['CALL zaehle()'], limits)
  assert.deepEqual(outcome.error, { index: 0, code: 'TOO_MUCH_DATA', message: TOO_MUCH })
  assert.deepEqual(session.kills, { query: 0, connection: 1 })
})

test('the set cap counts over the whole block', async () => {
  const session = fakeSession({ 'CALL a()': resultSets(3), 'CALL b()': resultSets(3) })
  const outcome = await runBlock(session, ['CALL a()', 'CALL b()'], limits)
  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.error.index, 1)
  assert.equal(outcome.error.code, 'TOO_MUCH_DATA')
})

test('large cells stop the block at the character cap', async () => {
  const session = fakeSession({ 'SELECT gross': [['fields', ['t']], ['row', ['x'.repeat(60)]], ['row', ['y'.repeat(60)]], ['loop']] })
  const outcome = await runBlock(session, ['SELECT gross'], limits)
  assert.deepEqual(outcome.error, { index: 0, code: 'TOO_MUCH_DATA', message: TOO_MUCH })
  assert.deepEqual(session.kills, { query: 0, connection: 1 })
})

test('cells become text the slide shows as is', () => {
  assert.equal(cellText(null), null)
  assert.equal(cellText(12), '12')
  assert.equal(cellText('1996-07-04'), '1996-07-04')
  assert.equal(cellText(Buffer.from([0xca, 0xfe])), '0xcafe')
  assert.equal(cellText({ a: 1 }), '{"a":1}')
})
