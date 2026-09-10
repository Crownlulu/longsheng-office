import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { createOfficeCloudHandler } from '../server/office-cloud.mjs'

const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  )
const close = (server) => new Promise((resolve) => server.close(resolve))
const request = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: options.method, headers: options.headers },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const headers = new Headers()
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers,
            }),
          )
        })
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })

test('cloud PostgreSQL persists full workflow, rolls back failed confirmation, protects sessions and restores after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-proxy-'))
  const env = {
    DATABASE_URL: 'postgres://test',
    OFFICE_ACCESS_CODE: 'test-access',
    OFFICE_CONFIG_KEY: 'a'.repeat(64),
    OFFICE_PUBLIC_ORIGIN: 'https://frontend.example',
  }
  let postgres,
    gateway,
    base,
    cookie = '',
    failConfirm = false
  const query = async (sql, params) => {
    if (failConfirm && sql.startsWith('INSERT INTO office_idempotency'))
      throw new Error('injected transaction failure')
    if (!params && sql.includes('CREATE TABLE'))
      return (await postgres.exec(sql)).at(-1)
    return postgres.query(sql, params)
  }
  // PGlite runs the PostgreSQL engine locally. Sequential requests exercise real
  // SQL/transactions, but do not claim Neon networking or multi-process lock tests.
  const pool = { query, connect: async () => ({ query, release() {} }) }
  const startBackend = async () => {
    postgres = new PGlite(join(dir, 'postgres'))
    gateway = http.createServer(createOfficeCloudHandler({ env, pool }))
    base = await listen(gateway)
  }
  await startBackend()
  const call = async (
    path,
    body,
    role = 'lead',
    origin = env.OFFICE_PUBLIC_ORIGIN,
  ) => {
    const response = await request(base + '/api/office' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Host: 'frontend.example',
        Origin: origin,
        Cookie: cookie,
        'X-Demo-Role': role,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.headers.has('set-cookie')) {
      assert.match(
        response.headers.get('set-cookie'),
        /HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000; Secure/,
      )
      cookie = response.headers.get('set-cookie').split(';')[0]
    }
    return { status: response.status, body: await response.json() }
  }
  const act = async (action, role) => {
    const p = (await call('/preview', { action }, role)).body.preview
    assert.equal(p.allowed, true, p.reason)
    const request = {
      previewId: p.id,
      expectedVersion: p.revision,
      idempotencyKey: randomUUID(),
    }
    const result = await call('/confirm', request, role)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(await call('/confirm', request, role), result)
    return result.body
  }
  try {
    assert.equal((await call('/snapshot')).body.error.code, 'ACCESS_REQUIRED')
    assert.equal((await call('/session', { accessCode: 'wrong' })).status, 401)
    assert.equal(
      (await call('/session', { accessCode: 'test-access' })).status,
      200,
    )
    assert.equal(
      (await call('/snapshot', undefined, 'lead', 'https://evil.example'))
        .status,
      403,
    )
    assert.equal((await call('/snapshot')).body.analysis.riskCount, 1)
    assert.equal(
      (await call('/chat', { question: '供应商延期有什么影响？' })).status,
      200,
    )
    const preview = (
      await call(
        '/preview',
        { action: { type: 'request_quality' } },
        'procurement',
      )
    ).body.preview
    const confirm = {
      previewId: preview.id,
      expectedVersion: preview.revision,
      idempotencyKey: randomUUID(),
    }
    const before = (await call('/snapshot')).body
    failConfirm = true
    assert.equal((await call('/confirm', confirm, 'procurement')).status, 500)
    failConfirm = false
    assert.deepEqual((await call('/snapshot')).body.state, before.state)
    assert.equal((await call('/confirm', confirm, 'procurement')).status, 200)
    await act({ type: 'start_task', taskId: 'T-QA' }, 'quality')
    await act(
      {
        type: 'submit_quality',
        taskId: 'T-QA',
        result: 'approved',
        evidence: '部署验证：质量通过',
      },
      'quality',
    )
    await act({ type: 'approve_switch' }, 'lead')
    await act({ type: 'send_tasks' }, 'lead')
    await act({ type: 'start_task', taskId: 'T-PUR' }, 'procurement')
    await act(
      {
        type: 'submit_receipt',
        taskId: 'T-PUR',
        evidence: '部署验证：采购已确认',
      },
      'procurement',
    )
    await act({ type: 'start_task', taskId: 'T-SALES' }, 'sales')
    await act(
      {
        type: 'submit_receipt',
        taskId: 'T-SALES',
        evidence: '部署验证：销售已确认',
      },
      'sales',
    )
    const closed = await act({ type: 'close_matter' }, 'lead')
    assert.equal(closed.state.matter.status, 'closed')
    assert.equal(
      (await call('/model', { apiKey: 'fixture-secret', mode: 'rules' }))
        .status,
      200,
    )
    const settings = (
      await postgres.query('SELECT settings FROM office_spaces')
    ).rows[0].settings
    assert.ok(!settings.includes('fixture-secret'))
    await close(gateway)
    await postgres.close()
    await startBackend()
    const restored = (await call('/snapshot')).body
    assert.equal(restored.workspaceId, closed.workspaceId)
    assert.deepEqual(restored.state, closed.state)
    assert.ok((await call('/runs')).body.runs.length > 0)
    assert.equal((await call('/model')).body.keyConfigured, true)
    cookie = ''
    const another = (await call('/session', { accessCode: 'test-access' })).body
    assert.notEqual(another.workspaceId, closed.workspaceId)
    assert.notEqual(another.state.matter.status, 'closed')
    // Rate limits survive handler restart because counters are in PostgreSQL.
    for (let i = 0; i < 11; i++) await call('/session', { accessCode: 'wrong' })
    assert.equal(
      (await call('/session', { accessCode: 'test-access' })).status,
      429,
    )
  } finally {
    await close(gateway)
    await postgres.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cloud missing configuration returns an actionable JSON error', async () => {
  const server = http.createServer(createOfficeCloudHandler({ env: {} }))
  const base = await listen(server)
  try {
    const response = await request(base + '/api/office/snapshot')
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'CLOUD_NOT_CONFIGURED')
  } finally { await close(server) }
})
