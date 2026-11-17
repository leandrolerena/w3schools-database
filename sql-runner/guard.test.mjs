import test from 'node:test'
import assert from 'node:assert/strict'
import { refusalReason } from './guard.mjs'

test('ordinary teaching statements pass', () => {
  for (const statement of [
    'SELECT * FROM customers',
    "UPDATE customers SET City = 'Bern' WHERE CustomerID = 1",
    'DELETE FROM order_details WHERE OrderID = 10248',
    'CREATE TABLE kunden (id INT PRIMARY KEY)',
    'DROP TABLE kunden',
    'ALTER TABLE kunden ADD COLUMN name VARCHAR(50)',
    'CREATE VIEW produktliste AS SELECT ProductName FROM products',
    "SELECT 'DROP DATABASE w3schools' AS text",
    'SET @summe = 0',
    'CALL zeige_kunden()',
  ]) assert.equal(refusalReason(statement), null, statement)
})

test('statements that would break the next exercise are refused in German', () => {
  assert.match(refusalReason('DROP DATABASE w3schools'), /^Datenbanken anlegen, ändern oder löschen/)
  assert.match(refusalReason('drop  schema `w3schools`'), /^Datenbanken/)
  assert.match(refusalReason('CREATE DATABASE test'), /^Datenbanken/)
  assert.match(refusalReason("CREATE USER 'x'@'%'"), /^Benutzer und Rechte/)
  assert.match(refusalReason('GRANT ALL ON *.* TO feusi'), /^Benutzer und Rechte/)
  assert.match(refusalReason("SET PASSWORD = 'neu'"), /^Benutzer und Rechte/)
  assert.match(refusalReason("ALTER USER CURRENT_USER() IDENTIFIED BY 'neu'"), /^Benutzer und Rechte/)
  assert.match(refusalReason("LOAD DATA INFILE '/etc/passwd' INTO TABLE t"), /^Dateien/)
  assert.match(refusalReason("SELECT * FROM customers INTO OUTFILE '/tmp/x'"), /^Dateien/)
  assert.match(refusalReason('LOCK TABLES customers WRITE'), /^Den MySQL-Server/)
  assert.match(refusalReason('KILL 12'), /^Den MySQL-Server/)
  assert.match(refusalReason('SHUTDOWN'), /^Den MySQL-Server/)
})

test('comments do not hide a refused statement, executable comments count as code', () => {
  assert.match(refusalReason('/* weg */ DROP DATABASE w3schools'), /^Datenbanken/)
  assert.match(refusalReason('-- weg\nDROP DATABASE w3schools'), /^Datenbanken/)
  assert.match(refusalReason('/*!50000 DROP DATABASE w3schools */'), /^Datenbanken/)
  assert.equal(refusalReason('SELECT 1 /* DROP DATABASE w3schools */'), null)
  assert.equal(refusalReason('SELECT 1 # DROP DATABASE w3schools'), null)
})
