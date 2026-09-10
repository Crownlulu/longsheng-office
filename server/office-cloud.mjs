import pg from 'pg'
import { database, initializeDatabase } from './office-postgres.mjs'
import {
  createHash,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto'
import {
  createState,
  analyze,
  getDocuments,
  previewAction,
  applyAction,
  migrateState,
} from './office-domain.mjs'
import { runOfficeChat, testProvider } from './office-model.mjs'
import {
  projectOffice,
  queryOfficeObjects,
  queryOfficeRelations,
} from './office-ontology.mjs'

const roles = [
  { id: 'procurement', label: '采购经办' },
  { id: 'quality', label: '质量负责人' },
  { id: 'sales', label: '销售经办' },
  { id: 'lead', label: '业务负责人' },
]
const hash = (value) => createHash('sha256').update(value).digest('hex')
function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code })
}
function questionFrom(body) {
  if (
    typeof body.question !== 'string' ||
    !body.question.trim() ||
    body.question.length > 4000
  )
    fail(422, 'INVALID_QUESTION', '请填写 1 至 4000 字的问题。')
  return body.question.trim()
}
function validateBase(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    fail(422, 'INVALID_PROVIDER', '模型地址格式不正确。')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail(
      422,
      'INVALID_PROVIDER',
      '模型地址须使用 HTTPS，且不能包含账号或查询参数。',
    )
  return url.toString().replace(/\/$/, '')
}

export function createOfficeCloudHandler({
  env = process.env,
  pool: providedPool,
} = {}) {
  let pool = providedPool
  let ready
  const busy = new Set()
  return async (req, res) => {
    let client,
      releaseError,
      transaction = false
    const json = async (res, status, value) => {
      if (transaction) {
        await client.query(status < 400 ? 'COMMIT' : 'ROLLBACK')
        transaction = false
      }
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(JSON.stringify(value))
    }
    try {
      const publicOrigin =
        env.OFFICE_PUBLIC_ORIGIN ||
        (env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
          : '')
      if (
        !env.DATABASE_URL ||
        !env.OFFICE_ACCESS_CODE ||
        !/^[a-f0-9]{64}$/i.test(env.OFFICE_CONFIG_KEY || '') ||
        !publicOrigin.startsWith('https://')
      ) {
        return await json(res, 503, {
          error: {
            code: 'CLOUD_NOT_CONFIGURED',
            message: '请配置数据库连接、演示访问码、加密密钥和公开访问地址。',
          },
        })
      }
      const accessCode = env.OFFICE_ACCESS_CODE
      const defaultMode = env.OFFICE_MODEL_MODE || 'rules'
      if (!['live', 'rules'].includes(defaultMode))
        fail(503, 'INVALID_MODE', '后台模型模式配置不正确。')
      const basePath = '/'
      const master = Buffer.from(env.OFFICE_CONFIG_KEY, 'hex')
      if (!pool) {
        pool = new pg.Pool({
          connectionString: env.DATABASE_URL,
          max: 4,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 10000,
          allowExitOnIdle: true,
        })
        pool.on('error', (error) =>
          console.error('[office-db] Pool error', { code: error.code }),
        )
      }
      if (!ready)
        ready = initializeDatabase(pool).catch((error) => {
          ready = undefined
          throw error
        })
      await ready
      const seal = (value) => {
        const iv = randomBytes(12)
        const c = createCipheriv('aes-256-gcm', master, iv)
        const body = Buffer.concat([c.update(value, 'utf8'), c.final()])
        return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
      }
      const unseal = (value) => {
        const bytes = Buffer.from(value, 'base64')
        const c = createDecipheriv('aes-256-gcm', master, bytes.subarray(0, 12))
        c.setAuthTag(bytes.subarray(12, 28))
        return Buffer.concat([
          c.update(bytes.subarray(28)),
          c.final(),
        ]).toString('utf8')
      }
      const defaults = {
        baseUrl: env.MODEL_BASE_URL || 'https://api.deepseek.com',
        model: env.MODEL_NAME || 'deepseek-v4-flash',
        apiKey: env.MODEL_API_KEY || '',
      }
      async function readBody(req) {
        if (req.body !== undefined && req.body !== null) {
          const raw =
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
          if (Buffer.byteLength(raw) > 262144)
            fail(413, 'BODY_TOO_LARGE', '请求内容过大。')
          let body
          try {
            body = JSON.parse(raw)
          } catch {
            fail(400, 'INVALID_JSON', '请求格式不正确。')
          }
          if (!body || typeof body !== 'object' || Array.isArray(body))
            fail(400, 'INVALID_JSON', '请求须为对象。')
          return body
        }
        let length = 0
        const chunks = []
        for await (const chunk of req) {
          length += chunk.length
          if (length > 262144) fail(413, 'BODY_TOO_LARGE', '请求内容过大。')
          chunks.push(chunk)
        }
        if (!length) return {}
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          fail(400, 'INVALID_JSON', '请求格式不正确。')
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          fail(400, 'INVALID_JSON', '请求须为对象。')
        return body
      }
      const host = req.headers.host || ''
      const allowedHosts = new Set(
        [
          env.VERCEL_URL,
          env.VERCEL_BRANCH_URL,
          env.VERCEL_PROJECT_PRODUCTION_URL,
          new URL(publicOrigin).host,
        ].filter(Boolean),
      )
      if (!allowedHosts.has(host))
        fail(403, 'HOST_DENIED', '不允许此访问地址。')
      if (req.headers.origin && req.headers.origin !== `https://${host}`)
        fail(403, 'ORIGIN_DENIED', '不允许跨站请求。')
      if (!['GET', 'POST'].includes(req.method))
        fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。')
      const path = new URL(req.url, `https://${host}`).pathname
      if (!path.startsWith('/api/office/'))
        fail(404, 'NOT_FOUND', '接口不存在。')
      const role = req.headers['x-demo-role'] || 'lead'
      if (!roles.some((item) => item.id === role))
        fail(403, 'INVALID_ROLE', '未知演示角色。')
      const body = req.method === 'POST' ? await readBody(req) : {}
      const route = `${req.method} ${path.slice('/api/office'.length)}`
      const token = /(?:^|;\s*)office_session=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie || '',
      )?.[1]
      if (route === 'POST /session') {
        const ip = String(
          req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown',
        )
        const bucket = hash(ip + ':' + Math.floor(Date.now() / 60000))
        await pool.query('DELETE FROM office_login_limits WHERE expires < $1', [
          Date.now(),
        ])
        const attempt = await pool.query(
          `INSERT INTO office_login_limits(id, count, expires) VALUES($1,1,$2)
          ON CONFLICT(id) DO UPDATE SET count=office_login_limits.count+1 RETURNING count`,
          [bucket, Date.now() + 120000],
        )
        if (attempt.rows[0].count > 10)
          fail(429, 'LOGIN_LIMIT', '尝试次数过多，请一分钟后重试。')
        if (
          typeof body.accessCode !== 'string' ||
          !timingSafeEqual(
            Buffer.from(hash(body.accessCode)),
            Buffer.from(hash(accessCode)),
          )
        )
          fail(401, 'ACCESS_INVALID', '访问码不正确。')
      }
      client = await pool.connect()
      await client.query('BEGIN')
      transaction = true
      await client.query("SET LOCAL statement_timeout = '15s'")
      await client.query(
        "SET LOCAL idle_in_transaction_session_timeout = '145s'",
      )
      if (token) {
        const lock = await client.query(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
          ['office:' + hash(token)],
        )
        if (!lock.rows[0].locked)
          fail(409, 'MODEL_BUSY', '当前空间正在处理请求，请稍后重试。')
      }
      const db = database(client)
      const getSpace = async (id) => {
        const row = await db.prepare('SELECT * FROM spaces WHERE id=?').get(id)
        const state = migrateState(JSON.parse(row.state))
        const serialized = JSON.stringify(state)
        if (serialized !== row.state)
          await db
            .prepare('UPDATE spaces SET state=? WHERE id=?')
            .run(serialized, id)
        return { ...row, state, settings: JSON.parse(row.settings) }
      }
      const saveSettings = (id, settings) =>
        db
          .prepare('UPDATE spaces SET settings=? WHERE id=?')
          .run(JSON.stringify(settings), id)
      const activeProvider = (settings) => ({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.encryptedKey
          ? unseal(settings.encryptedKey)
          : settings.baseUrl === defaults.baseUrl && !settings.keyRemoved
            ? defaults.apiKey
            : '',
      })
      const safeSettings = (settings) => ({
        baseUrl: settings.baseUrl,
        model: settings.model,
        mode: settings.mode,
        keyConfigured: Boolean(activeProvider(settings).apiKey),
        connection: settings.connection,
        maxRounds: 4,
      })
      const snapshot = (space, role) => ({
        state: { ...space.state, documents: getDocuments(space.state) },
        analysis: analyze(space.state),
        graph: projectOffice(space.state, space.id),
        role,
        roles,
        workspaceId: space.id,
      })
      const record = (space, kind, value) =>
        db
          .prepare('INSERT INTO records VALUES(?,?,?,?,?)')
          .run(
            value.id,
            space,
            kind,
            JSON.stringify(value),
            value.createdAt || new Date().toISOString(),
          )
      const safeResult = (value, secret) =>
        secret
          ? JSON.parse(JSON.stringify(value).split(secret).join('[已隐藏凭据]'))
          : value
      let row =
        token &&
        (await db
          .prepare('SELECT id FROM spaces WHERE token_hash=?')
          .get(hash(token)))
      if (!row && route !== 'POST /session')
        fail(401, 'ACCESS_REQUIRED', '请输入演示访问码。')
      if (!row) {
        const nextToken = randomBytes(32).toString('hex')
        const id = randomUUID()
        await db
          .prepare('INSERT INTO spaces VALUES(?,?,?,?)')
          .run(
            id,
            hash(nextToken),
            JSON.stringify(createState()),
            JSON.stringify({
              baseUrl: defaults.baseUrl,
              model: defaults.model,
              mode: defaultMode,
            }),
          )
        row = { id }
        res.setHeader(
          'Set-Cookie',
          `office_session=${nextToken}; HttpOnly; SameSite=Strict; Path=${basePath}; Max-Age=2592000; Secure`,
        )
      }
      const space = await getSpace(row.id)
      if (route === 'POST /session')
        return await json(res, 200, snapshot(space, role))
      if (route === 'GET /snapshot')
        return await json(res, 200, snapshot(space, role))
      if (route === 'GET /graph')
        return await json(res, 200, projectOffice(space.state, space.id))
      if (route === 'GET /objects')
        return await json(
          res,
          200,
          queryOfficeObjects(
            space.state,
            Object.fromEntries(new URL(req.url, `http://${host}`).searchParams),
          ),
        )
      if (route === 'GET /relations') {
        const args = Object.fromEntries(
          new URL(req.url, `http://${host}`).searchParams,
        )
        return await json(
          res,
          200,
          queryOfficeRelations(space.state, {
            ...args,
            depth: args.depth === undefined ? 1 : Number(args.depth),
          }),
        )
      }
      if (route === 'GET /documents')
        return await json(res, 200, { documents: getDocuments(space.state) })
      if (route === 'GET /model')
        return await json(res, 200, safeSettings(space.settings))
      if (route === 'GET /runs') {
        const rows = await db
          .prepare(
            'SELECT kind,body FROM records WHERE space=? ORDER BY created DESC LIMIT 200',
          )
          .all(space.id)
        return await json(res, 200, {
          runs: rows
            .filter((x) => x.kind === 'run')
            .map((x) => JSON.parse(x.body)),
          comparisons: rows
            .filter((x) => x.kind === 'comparison')
            .map((x) => JSON.parse(x.body)),
        })
      }
      if (route === 'POST /preview') {
        if (!body.action || typeof body.action.type !== 'string')
          fail(422, 'INVALID_ACTION', '请选择操作。')
        if (body.expectedVersion !== undefined) {
          if (!Number.isInteger(body.expectedVersion))
            fail(422, 'INVALID_VERSION', '请提供有效的数据版本。')
          if (body.expectedVersion !== space.state.revision)
            fail(
              409,
              'STALE_VERSION',
              '事项已更新，请重新查询或核对最新任务后再操作。',
            )
        }
        const preview = {
          ...previewAction(space.state, body.action, role),
          id: randomUUID(),
          role,
        }
        await db.prepare('DELETE FROM previews WHERE expires<?').run(Date.now())
        await db
          .prepare(
            'INSERT INTO previews(id,space,body,expires) VALUES(?,?,?,?)',
          )
          .run(
            preview.id,
            space.id,
            JSON.stringify(preview),
            Date.now() + 600000,
          )
        return await json(res, 200, { preview })
      }
      if (route === 'POST /confirm') {
        if (
          typeof body.idempotencyKey !== 'string' ||
          body.idempotencyKey.length < 8 ||
          body.idempotencyKey.length > 160 ||
          typeof body.previewId !== 'string' ||
          !Number.isInteger(body.expectedVersion)
        )
          fail(422, 'INVALID_CONFIRM', '缺少有效的确认编号或数据版本。')
        const requestHash = hash(
          JSON.stringify({
            role,
            previewId: body.previewId,
            expectedVersion: body.expectedVersion,
          }),
        )
        // Confirmation participates in this request transaction.
        try {
          const prior = await db
            .prepare('SELECT * FROM idempotency WHERE space=? AND key=?')
            .get(space.id, body.idempotencyKey)
          if (prior) {
            if (prior.hash !== requestHash)
              fail(409, 'IDEMPOTENCY_CONFLICT', '此确认编号已用于其他操作。')
            const savedResponse = JSON.parse(prior.response)
            const migratedResponse = snapshot(
              {
                id: savedResponse.workspaceId,
                state: migrateState(savedResponse.state),
              },
              role,
            )
            return await json(res, 200, migratedResponse)
          }
          const saved = await db
            .prepare('SELECT * FROM previews WHERE id=? AND space=?')
            .get(body.previewId, space.id)
          if (!saved || saved.expires < Date.now())
            fail(409, 'PREVIEW_EXPIRED', '操作预览已过期，请重新预览。')
          if (saved.used)
            fail(409, 'PREVIEW_USED', '该预览已确认，请刷新查看结果。')
          const preview = JSON.parse(saved.body)
          if (preview.role !== role)
            fail(403, 'ROLE_CHANGED', '角色已变更，请以当前角色重新预览。')
          const current = await getSpace(space.id)
          if (
            body.expectedVersion !== current.state.revision ||
            preview.revision !== current.state.revision
          )
            fail(409, 'STALE_VERSION', '数据已更新，请刷新后重新确认。')
          const state = applyAction(current.state, preview.action, role)
          await db
            .prepare('UPDATE spaces SET state=? WHERE id=?')
            .run(JSON.stringify(state), space.id)
          if (preview.action.type === 'reset') {
            await db.prepare('DELETE FROM previews WHERE space=?').run(space.id)
            await db
              .prepare('DELETE FROM idempotency WHERE space=?')
              .run(space.id)
          } else
            await db
              .prepare('UPDATE previews SET used=1 WHERE id=?')
              .run(preview.id)
          const response = snapshot({ ...current, state }, role)
          await db
            .prepare('INSERT INTO idempotency VALUES(?,?,?,?)')
            .run(
              space.id,
              body.idempotencyKey,
              requestHash,
              JSON.stringify(response),
            )
          return await json(res, 200, response)
        } catch (error) {
          throw error
        }
      }
      if (route === 'POST /model') {
        if (role !== 'lead')
          fail(403, 'FORBIDDEN', '仅业务负责人可调整模型连接。')
        if (busy.has(space.id))
          fail(409, 'MODEL_BUSY', '模型正在运行，请结束后再调整连接。')
        const settings = { ...space.settings }
        if (body.baseUrl !== undefined) {
          if (typeof body.baseUrl !== 'string')
            fail(422, 'INVALID_PROVIDER', '请填写模型地址。')
          const next = validateBase(body.baseUrl)
          if (next !== settings.baseUrl) {
            delete settings.encryptedKey
            settings.keyRemoved = true
          }
          settings.baseUrl = next
        }
        if (body.model !== undefined) {
          if (
            typeof body.model !== 'string' ||
            !body.model.trim() ||
            body.model.length > 160
          )
            fail(422, 'INVALID_MODEL', '请填写有效模型名称。')
          settings.model = body.model.trim()
        }
        if (body.mode !== undefined) {
          if (!['live', 'rules'].includes(body.mode))
            fail(422, 'INVALID_MODE', '请选择真实模型或规则模式。')
          settings.mode = body.mode
        }
        if (body.apiKey !== undefined && body.apiKey !== '') {
          if (typeof body.apiKey !== 'string' || body.apiKey.length > 8192)
            fail(422, 'INVALID_KEY', '密钥格式不正确。')
          settings.encryptedKey = seal(body.apiKey.trim())
          settings.keyRemoved = false
        }
        delete settings.connection
        await saveSettings(space.id, settings)
        return await json(res, 200, safeSettings(settings))
      }
      if (['POST /model/test', 'POST /chat', 'POST /compare'].includes(route)) {
        if (route === 'POST /model/test' && role !== 'lead')
          fail(403, 'FORBIDDEN', '仅业务负责人可测试连接。')
        if (busy.has(space.id))
          fail(409, 'MODEL_BUSY', '当前演示正在调用模型，请等待本次结束。')
        if (busy.size >= 4)
          fail(429, 'MODEL_CAPACITY', '当前模型调用较多，请稍后重试。')
        const question =
          route === 'POST /model/test' ? null : questionFrom(body)
        const selectedMode = body.mode ?? space.settings.mode
        if (!['live', 'rules'].includes(selectedMode))
          fail(422, 'INVALID_MODE', '模型运行方式不正确。')
        const modelProvider = activeProvider(space.settings)
        busy.add(space.id)
        try {
          if (route === 'POST /model/test') {
            const connection = safeResult(
              await testProvider(modelProvider),
              modelProvider.apiKey,
            )
            await saveSettings(space.id, {
              ...space.settings,
              connection: { ...connection, testedAt: new Date().toISOString() },
            })
            return await json(res, 200, connection)
          }
          const run = async (variant) =>
            safeResult(
              await runOfficeChat({
                state: structuredClone(space.state),
                question,
                role,
                provider: { ...modelProvider },
                variant,
                mode: route === 'POST /compare' ? 'live' : selectedMode,
                signal: AbortSignal.timeout(120000),
              }),
              modelProvider.apiKey,
            )
          if (route === 'POST /chat') {
            const result = await run('ontology')
            await record(space.id, 'run', result)
            return await json(res, 200, { run: result })
          }
          const [baseline, ontology] = await Promise.all([
            run('baseline'),
            run('ontology'),
          ])
          const comparison = {
            id: randomUUID(),
            question,
            revision: space.state.revision,
            model: modelProvider.model,
            role,
            createdAt: new Date().toISOString(),
            baseline,
            ontology,
          }
          await record(space.id, 'comparison', comparison)
          return await json(res, 200, { comparison })
        } finally {
          busy.delete(space.id)
        }
      }
      fail(404, 'NOT_FOUND', '接口不存在。')
    } catch (error) {
      console.error('[office-api] Request failed', {
        code: error.code || 'SERVER_ERROR',
        status: error.status || 500,
      })
      if (transaction) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          releaseError = rollbackError
        }
        transaction = false
      }
      if (!res.headersSent)
        await json(res, error.status || 500, {
          error: {
            code: error.status ? error.code : 'DATABASE_OR_SERVER_ERROR',
            message: error.status
              ? error.message
              : '后台服务暂时不可用，请联系维护人员查看日志。',
          },
        })
      else res.end()
    } finally {
      if (client) client.release(releaseError)
    }
  }
}
