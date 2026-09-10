import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createOfficeServer } from '../server/office-server.mjs'
import { createOfficeProxy } from '../server/office-proxy.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => server.close(resolve))
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method: options.method, headers: options.headers }, res => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk))
    res.on('end', () => {
      const headers = new Headers()
      for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
      resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }))
    })
  })
  req.on('error', reject)
  req.end(options.body)
})

test('gateway forwards authenticated workflow, cookies, guards, idempotency and durable restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-proxy-'))
  const env = { OFFICE_BACKEND_ORIGIN: 'https://backend.example', OFFICE_FRONTEND_ORIGIN: 'https://frontend.example' }
  let backend, localBackend, gateway, base, cookie = ''
  const startBackend = async () => {
    backend = createOfficeServer({ dbPath: join(dir, 'office.sqlite'), publicOrigin: env.OFFICE_BACKEND_ORIGIN, accessCode: 'test-access', defaultMode: 'rules' })
    localBackend = await listen(backend)
  }
  await startBackend()
  // Substitute only TLS transport with loopback; preserve production Host/Origin checks.
  gateway = http.createServer(createOfficeProxy({ env, fetchImpl: (url, options) => {
    assert.equal(url.origin, env.OFFICE_BACKEND_ORIGIN)
    return request(localBackend + url.pathname + url.search, { ...options, headers: { ...options.headers, Host: 'backend.example' } })
  } }))
  base = await listen(gateway)
  const call = async (path, body, role = 'lead', origin = env.OFFICE_FRONTEND_ORIGIN) => {
    const response = await request(base + '/api/office' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Host: 'frontend.example', Origin: origin, Cookie: cookie, 'X-Demo-Role': role, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (response.headers.has('set-cookie')) {
      assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000; Secure/)
      cookie = response.headers.get('set-cookie').split(';')[0]
    }
    return { status: response.status, body: await response.json() }
  }
  const act = async (action, role) => {
    const p = (await call('/preview', { action }, role)).body.preview
    assert.equal(p.allowed, true, p.reason)
    const request = { previewId: p.id, expectedVersion: p.revision, idempotencyKey: randomUUID() }
    const result = await call('/confirm', request, role)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(await call('/confirm', request, role), result)
    return result.body
  }
  try {
    assert.equal((await call('/snapshot')).body.error.code, 'ACCESS_REQUIRED')
    assert.equal((await call('/session', { accessCode: 'wrong' })).status, 401)
    assert.equal((await call('/session', { accessCode: 'test-access' })).status, 200)
    assert.equal((await call('/snapshot', undefined, 'lead', 'https://evil.example')).status, 403)
    assert.equal((await call('/snapshot')).body.analysis.riskCount, 1)
    assert.equal((await call('/chat', { question: '供应商延期有什么影响？' })).status, 200)
    await act({ type: 'request_quality' }, 'procurement')
    await act({ type: 'start_task', taskId: 'T-QA' }, 'quality')
    await act({ type: 'submit_quality', taskId: 'T-QA', result: 'approved', evidence: '部署验证：质量通过' }, 'quality')
    await act({ type: 'approve_switch' }, 'lead')
    await act({ type: 'send_tasks' }, 'lead')
    await act({ type: 'start_task', taskId: 'T-PUR' }, 'procurement')
    await act({ type: 'submit_receipt', taskId: 'T-PUR', evidence: '部署验证：采购已确认' }, 'procurement')
    await act({ type: 'start_task', taskId: 'T-SALES' }, 'sales')
    await act({ type: 'submit_receipt', taskId: 'T-SALES', evidence: '部署验证：销售已确认' }, 'sales')
    const closed = await act({ type: 'close_matter' }, 'lead')
    assert.equal(closed.state.matter.status, 'closed')
    await close(backend)
    await startBackend()
    const restored = (await call('/snapshot')).body
    assert.equal(restored.workspaceId, closed.workspaceId)
    assert.deepEqual(restored.state, closed.state)
    assert.ok((await call('/runs')).body.runs.length > 0)
  } finally {
    await close(gateway); await close(backend)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('gateway diagnoses missing config, rejects non-JSON upstream and does not follow redirects', async () => {
  for (const [env, expected, mock] of [
    [{}, 'BACKEND_NOT_CONFIGURED', null],
    [{ OFFICE_BACKEND_ORIGIN: 'https://frontend.example', OFFICE_FRONTEND_ORIGIN: 'https://frontend.example' }, 'BACKEND_NOT_CONFIGURED', null],
    [{ OFFICE_BACKEND_ORIGIN: 'https://backend.example', OFFICE_FRONTEND_ORIGIN: 'https://frontend.example' }, 'BACKEND_INVALID_RESPONSE', async (_url, options) => {
      assert.equal(options.redirect, 'manual')
      return new Response('Not Found', { status: 404 })
    }],
  ]) {
    const server = http.createServer(createOfficeProxy({ env, ...(mock ? { fetchImpl: mock } : {}) }))
    const base = await listen(server)
    try {
      const response = await request(base + '/api/office/snapshot', { headers: { Host: 'frontend.example' } })
      assert.equal((await response.json()).error.code, expected)
    } finally { await close(server) }
  }
})
