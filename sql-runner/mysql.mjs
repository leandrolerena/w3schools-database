import mysql from 'mysql2'

// Rows as arrays keep duplicate column names (SELECT a.id, b.id); dates and big numbers
// stay the text MySQL sent. One query is one statement: the client splits the block, and
// a statement that hides a second one (`SELECT 1; DELETE …`) is refused by MySQL.
const CONNECTION_OPTIONS = { rowsAsArray: true, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false }

export const connectionConfig = config => ({ ...config, ...CONNECTION_OPTIONS })

// What the slides may do in w3schools: everything a lesson needs, nothing outside it.
const PRIVILEGES = 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, '
  + 'CREATE TEMPORARY TABLES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE, TRIGGER'

function connect(config) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(connectionConfig(config))
    connection.on('error', () => {})
    connection.connect(error => error ? reject(error) : resolve(connection))
  })
}

// Created on every start, because the init scripts never run again on an existing data/ folder.
export async function provisionUser(adminConfig, { user, password, database }) {
  const admin = (await connect(adminConfig)).promise()
  try {
    await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [user, '%', password])
    await admin.query('ALTER USER ?@? IDENTIFIED BY ?', [user, '%', password])
    await admin.query(`GRANT ${PRIVILEGES} ON ${mysql.escapeId(database)}.* TO ?@?`, [user, '%'])
  }
  finally {
    admin.connection.destroy()
  }
}

export async function openSession(config) {
  const connection = await connect(config)
  return {
    stream(sql, handlers) {
      connection.query(sql)
        .on('fields', fields => fields && handlers.fields(fields.map(field => field.name)))
        .on('result', result => Array.isArray(result) ? handlers.row(result) : handlers.header(result))
        .on('error', handlers.error)
        .on('end', handlers.end)
    },
    killQuery: () => kill(config, 'QUERY', connection.threadId),
    killConnection: () => kill(config, 'CONNECTION', connection.threadId),
    close: () => connection.destroy(),
  }
}

async function kill(config, what, threadId) {
  const killer = await connect(config)
  try {
    await killer.promise().query(`KILL ${what} ?`, [threadId])
  }
  finally {
    killer.destroy()
  }
}
