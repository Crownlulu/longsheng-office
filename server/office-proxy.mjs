// Stateless Vercel gateway. The existing backend owns sessions and SQLite.
export function createOfficeProxy({ env = process.env, fetchImpl = fetch } = {}) {
  const json = (res, status, code, message) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: { code, message } }))
  }
  return async (req, res) => {
    let backend, frontend
    try {
      backend = new URL(env.OFFICE_BACKEND_ORIGIN)
      frontend = new URL(env.OFFICE_FRONTEND_ORIGIN)
      for (const url of [backend, frontend]) {
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin')
      }
      if (backend.origin === frontend.origin) throw new Error('Proxy loop')
    } catch {
      return json(res, 503, 'BACKEND_NOT_CONFIGURED', '后台服务尚未配置，请联系演示维护人员。')
    }
    if (req.headers.host !== frontend.host || (req.headers.origin && req.headers.origin !== frontend.origin)) {
      return json(res, 403, 'ORIGIN_DENIED', '不允许此访问地址或跨站请求。')
    }
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。')
    const incoming = new URL(req.url, frontend)
    // Restrict destinations to this application's API, including nested /model/test.
    if (!/^\/api\/office\/[a-z]+(?:\/[a-z]+)?$/.test(incoming.pathname)) {
      return json(res, 404, 'NOT_FOUND', '接口不存在。')
    }
    try {
      let body
      if (req.method === 'POST') {
        if (req.body !== undefined) body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)
        else {
          const chunks = []; let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 262144) return json(res, 413, 'BODY_TOO_LARGE', '请求内容过大。')
            chunks.push(chunk)
          }
          body = Buffer.concat(chunks)
        }
        if (Buffer.byteLength(body) > 262144) return json(res, 413, 'BODY_TOO_LARGE', '请求内容过大。')
      }
      const headers = { 'Content-Type': 'application/json', Origin: backend.origin }
      for (const name of ['cookie', 'x-demo-role']) if (req.headers[name]) headers[name] = req.headers[name]
      // Vercel supplies this header; do not forward a client-provided x-real-ip.
      if (env.VERCEL && req.headers['x-vercel-forwarded-for']) headers['x-real-ip'] = String(req.headers['x-vercel-forwarded-for']).split(',')[0].trim()
      const upstream = await fetchImpl(new URL(incoming.pathname + incoming.search, backend), {
        method: req.method, headers, ...(body !== undefined ? { body } : {}),
        redirect: 'manual', signal: AbortSignal.timeout(135000),
      })
      if (!upstream.headers.get('content-type')?.includes('application/json')) {
        console.error('[office-proxy] Non-JSON backend response', { status: upstream.status })
        return json(res, 502, 'BACKEND_INVALID_RESPONSE', '后台服务响应异常，请联系演示维护人员。')
      }
      const data = await upstream.text()
      JSON.parse(data)
      const cookies = upstream.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(data)
    } catch (error) {
      console.error('[office-proxy] Backend request failed', { name: error.name })
      return json(res, 502, 'BACKEND_UNAVAILABLE', '后台服务暂时无法连接，请稍后重试。')
    }
  }
}
