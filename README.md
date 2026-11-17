# W3Schools Database in Docker

Forked from https://github.com/AndrejPHP/w3schools-database for academic purposes.

This repository provides:

- a docker compose which sets up the DB on port 3309 (non-default, no clashes)
- a REST API on port 3000 and the `sql-runner` service for the course slides on port 3001
- initializes the database data from w3schools (provided by @AndrejPHP) 
- Visual Studio Code config

## Setup 

- Setup is as easy as:

```bash
docker-compose up -d
```

-  Data is stored in the data directory

### After pulling a new version

Stop and remove the containers first, then build and start again. Your data in `data` stays.

```bash
docker-compose down
docker-compose up -d --build
```

- **Why `down` first:** `docker-compose` v1 (the one in the student VM) crashes when it has to
  replace a running container with one from a newer image under a current Docker Engine, with
  `KeyError: 'ContainerConfig'` (in `get_container_data_volumes`). After `down` there is
  nothing to replace, so it does not happen. No setting in `docker-compose.yml` avoids it;
  Compose v2 (`docker compose`) does not have the bug.
- **If you already hit the crash:** run the two commands above. `docker-compose down` also
  removes the dead container it left behind (named like `…_sql-runner_1` or `…_rest-api_1`,
  status `Exited (137)`). Ubuntu may then report a "system program problem" for
  `docker-compose`; that report can be dismissed.
- **Network:** the build of the `sql-runner` image pulls a 227 MB Node base image and its npm
  packages. Under `docker-compose` v1 a failed build stops the whole
  `up`, so the database and REST API do not start either; run it again once the network is back.


## Tables

When the docker container starts, it creates database named __w3schools__ with the following tables

    categories
    customers
    employees
    orders
    order_details
    products
    shippers
    suppliers
    
and inserts the respective data. 

## SQL from the slides (`sql-runner`)

The runnable SQL blocks on the course slides use a database in the browser by default.
Switched to «MySQL in der VM», a block is sent to the `sql-runner` service in
[`sql-runner/`](sql-runner/), which runs it in this MySQL.

- Port 3001, bound to `127.0.0.1`: only a browser on the same machine reaches it. It
  answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]` (Host header).
- `GET /health` answers `{"ready":true}` once the service can log in as its MySQL user. After
  a start or a reset it says not ready for up to about a minute, while MySQL starts, and then
  recovers by itself.
- `POST /run` with `{"statements": ["SELECT …", "…"]}` runs the statements in order on one
  connection and answers with the result of each, or stops at the first error
  (`{"index": …, "message": "ERROR 1146 (42S02): …"}`).
- It connects as MySQL user `sqlrunner`, which it creates as root on every start, with
  privileges on `w3schools` only: read and change rows; create, alter and drop tables,
  views, indexes, procedures and triggers. If that user's login is refused (a block changed
  its password), the service sets the user up again before the next block or health check.
- Refused with a German message before MySQL sees them: creating, altering or dropping a
  database, users and privileges, reading or writing files, and server commands (`KILL`,
  `LOCK TABLES`, `FLUSH`, `SHUTDOWN`, `SET GLOBAL`).
- Limits: 1000 rows per result (the rest of that query is stopped, the block goes on);
  per block 10 seconds, 20 result tables, 2 MB of result text and 50 statements; 8 blocks
  at once (more get a "busy" answer, so a flood of blocks cannot take MySQL's connections
  from the REST API; `/health` logs in to MySQL at most once per second).
  Past the time or data limit the service closes the block's MySQL connection, which also
  ends a procedure that loops on `SLEEP`.
- Allowed pages: the environment variable `SQL_RUNNER_ORIGINS` (comma-separated, `:*` for any
  port), default `http://localhost:*,http://127.0.0.1:*,https://leandrolerena.github.io`.
  It must name the address the slides are actually served from. Nothing is published at
  `https://leandrolerena.github.io` yet; that entry is the expected address of the course
  site. Slides served from another address get "nicht erreichbar" until it is added.

`npm test` in `sql-runner/` runs its tests without Docker or MySQL.

### What a student can break

Everything a block changes stays in MySQL, for the next exercise, the REST API and the
store: deleted or changed rows, dropped or altered tables, a trigger that makes inserts
fail. The refusals stop the direct ways of dropping the database or touching users, but not
changes to the data; a block written to get around them (a prepared statement, for example)
can still drop the database. Each of these is undone by the reset below.

Who can send blocks: any page served from `localhost` or `127.0.0.1` on any port, and any
page under `https://leandrolerena.github.io`, which all GitHub Pages projects of that
account share, not only the course slides. Such a page can do what a block can do: change
or drop the w3schools data, nothing outside it. Narrow `SQL_RUNNER_ORIGINS` if that matters.

## How to reset?

This deletes every change, including those made from the slides. `data` belongs to root,
because MySQL in Docker writes it. Starting with `down` also avoids the `ContainerConfig`
crash described under "After pulling a new version". MySQL then sets up the database again,
which takes up to about a minute.

```bash
docker-compose down
sudo rm -rf data
docker-compose up -d
```
