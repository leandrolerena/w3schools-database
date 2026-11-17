import { createServer } from 'node:http'
import { createAccount } from './account.mjs'
import { parseOrigins } from './cors.mjs'
import { createHandler } from './http.mjs'
import { openSession, provisionUser } from './mysql.mjs'
import { runBlock } from './run.mjs'

const env = process.env
const PORT = Number(env.PORT ?? 3001)
const RETRY_MS = 3000
const ALLOWED_ORIGINS = parseOrigins(env.SQL_RUNNER_ORIGINS ?? 'http://localhost:*,http://127.0.0.1:*,https://leandrolerena.github.io')

const server = { host: env.MYSQL_HOST ?? '127.0.0.1', port: Number(env.MYSQL_PORT ?? 3309) }
const account = { user: env.SQL_RUNNER_USER ?? 'sqlrunner', password: env.SQL_RUNNER_PASSWORD ?? 'sqlrunner', database: 'w3schools' }
const admin = { ...server, user: 'root', password: env.MYSQL_ROOT_PASSWORD ?? 'root' }

const mysqlUser = createAccount({
  provision: async () => {
    await provisionUser(admin, account)
    console.log(`MySQL user ${account.user} is set up`)
  },
  login: () => openSession({ ...server, ...account }),
})

async function provisionWhenMysqlIsUp() {
  for (;;) {
    try {
      await mysqlUser.provision()
      return
    }
    catch (error) {
      console.log(`Waiting for MySQL at ${server.host}:${server.port}: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, RETRY_MS))
    }
  }
}

async function runStatements(statements) {
  const session = await mysqlUser.open()
  try {
    return await runBlock(session, statements)
  }
  finally {
    session.close()
  }
}

createServer(createHandler({ allowedOrigins: ALLOWED_ORIGINS, isReady: mysqlUser.isReady, runStatements }))
  .listen(PORT, () => console.log(`SQL runner listening on port ${PORT}, allowed origins: ${ALLOWED_ORIGINS.join(', ')}`))
provisionWhenMysqlIsUp()
