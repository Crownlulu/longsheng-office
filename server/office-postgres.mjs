// The domain's SQL uses positional ? parameters. Only these fixed internal
// statements enter this adapter; user data always remains bound parameters.
export function database(client) {
  return {
    prepare(statement) {
      let index = 0
      const sql = statement
        .replace(/\b(spaces|previews|idempotency|records)\b/g, 'office_$1')
        .replace(/\?/g, () => `$${++index}`)
      return {
        get: async (...params) => (await client.query(sql, params)).rows[0],
        all: async (...params) => (await client.query(sql, params)).rows,
        run: async (...params) => client.query(sql, params),
      }
    },
  }
}

export async function initializeDatabase(pool) {
  const client = await pool.connect()
  let releaseError
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '10s'")
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('office:schema:v1', 0))",
    )
    await client.query(`
      CREATE TABLE IF NOT EXISTS office_spaces(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, state TEXT NOT NULL, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS office_previews(id TEXT PRIMARY KEY, space TEXT NOT NULL, body TEXT NOT NULL, expires BIGINT NOT NULL, used INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS office_idempotency(space TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(space,key));
      CREATE TABLE IF NOT EXISTS office_records(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS office_records_space_created ON office_records(space, created DESC);
      CREATE TABLE IF NOT EXISTS office_login_limits(id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL);
    `)
    await client.query('DELETE FROM office_login_limits WHERE expires < $1', [
      Date.now(),
    ])
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch (rollbackError) { releaseError = rollbackError }
    throw error
  } finally {
    client.release(releaseError)
  }
}
