# 龙盛 Demo：部署排查与执行手册

## 本次诊断（2026-09-10）

已实际请求 https://longsheng-office.vercel.app/api/office/snapshot ：返回 HTTP 404、content-type text/plain、Vercel NOT_FOUND。
前端 api.ts 调用 response.json()，解析失败后显示 INVALID_RESPONSE。
源码中的 npm run build 仅生成 dist；office-server.mjs 负责业务 API、会话和 SQLite，旧版没有 Vercel API 入口。
因此分支和前端构建成功，不等于业务服务已部署。环境变量为空不是这次 404 的直接原因。

本次实际尝试 Vercel MCP：list_teams 返回空数组；按已知项目名和截图中的团队 slug 查询返回 403。
这不能证明账户没有团队，只能说明本会话尚不能读取目标资源。插件已安装，仍需核对其连接账户和授权范围。

## 选定的部署结构

浏览器 → Vercel 静态网页 → 同域 /api/office/* 函数 → HTTPS Node 后端 → SQLite 持久卷。

这属于 Vercel 前端与独立后端联合部署，不是全部服务都在 Vercel 中。
沿用现有 SQLite 事务、版本校验和幂等机制。若要求所有业务计算均运行于 Vercel，则需要另外迁移共享数据库与跨实例并发控制；本补丁没有实施这种迁移。

新增文件：

- vercel.json：构建、API 时限和 /office 页面刷新路由。
- api/office/[...path].mjs：Vercel API 入口。
- server/office-proxy.mjs：固定 HTTPS 后端转发、同源检查、Cookie 与角色头传递、错误 JSON 和禁止跟随重定向。
- deploy/Dockerfile.backend：Node 24 后端镜像，初始化可写 /data。
- deploy/compose.yaml、Caddyfile：单实例后端、SQLite 持久卷、HTTPS 入口。
- tests/office-proxy.test.mjs：网关到真实业务后端的集成验证。

## 0. 补齐发布条件

需要可管理当前 Vercel 项目的连接；需要能推送 Crownlulu 仓库的 Git 环境；需要一台可运行 Docker Compose 的服务器及指向它的后端域名。
优先使用团队已经授权的服务器，不默认新购资源。没有服务器/域名时，此处停下，先确定运行位置，不随便填写示例地址。
禁止拿原 Demo 的未知版本后端直接混用；需部署本次相同源码，避免批准与发送状态协议不一致。

## 1. 取得代码

本次修复分支 codex/vercel-backend-deployment-fix 基于 c1aabf0；原修改分支和 main 保留。
若修复分支已推送，在有权限的电脑或服务器中：

```bash
git fetch origin
git switch codex/vercel-backend-deployment-fix
```

若尚未推送，应先在持有本次提交的环境推送该分支，或使用 git bundle 转移；从远端 fetch 无法取得仅存在本地的提交。

## 2. 部署后端（在已授权服务器执行）

前提：Docker Engine 和 Compose 可用；后端域名 DNS 指向该服务器；80/443 可用且未被其他服务占用。
若服务器已有 HTTPS 网关，请由维护人员接入既有网关，不直接争用端口。

在仓库目录执行：

```bash
cp deploy/.env.example deploy/.env
```

编辑 deploy/.env：BACKEND_DOMAIN 填真实域名（不带 https://）；OFFICE_ACCESS_CODE 填自行设置的演示访问码。
该文件已被 gitignore 排除，不提交，不把访问码发进聊天或前端代码。

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

浏览器访问 https://你的后端域名/healthz，必须返回 JSON，ok 和 database 都为 true。
访问 https://你的后端域名/api/office/snapshot，未登录应返回 HTTP 401 与 ACCESS_REQUIRED；这说明接口存在且访问码保护生效。

后端不包含前端 dist，直接访问后端根路径不是网页验收地址。
Compose 默认 OFFICE_MODEL_MODE=rules，使用明确的规则模式，不需要模型密钥。真实模型验证另行配置；不能把规则模式写成真实模型通过。
office_data 卷包含数据库和 config.key，备份时停后端并备份整个卷。不要执行 docker compose down -v（会删除持久数据）。后端保持单实例。
Caddy 重写 X-Real-IP 防止客户端伪造；经过网关时登录限流可能聚合到网关出口，适合小规模 Demo，扩大使用前应另行设计可信代理链和限流。

## 3. 配置 Vercel

使用现有 longsheng-office 项目，无须删除重建。

| 配置 | 值 |
|---|---|
| 源码分支 | codex/vercel-backend-deployment-fix |
| Framework | Vite |
| Root | ./ |
| Node | 24.x |
| Install | npm ci |
| Build | npm run build |
| Output | dist |
| Fluid Compute | 开启，函数时限需允许 150 秒 |

在 Settings → Environment Variables 添加两个服务端变量：

| 名称 | 值 |
|---|---|
| OFFICE_BACKEND_ORIGIN | https://真实后端域名 |
| OFFICE_FRONTEND_ORIGIN | https://longsheng-office.vercel.app |

变量必须是纯 origin，不含路径、账号或查询参数。后端地址不能填前端自己的地址。
访问码配置在后端，模型密钥也只配置在后端，不使用 VITE_ 前缀。

如做 Preview 验证，OFFICE_FRONTEND_ORIGIN 应设置为将用于访问的准确 Preview 域名；严格同源检查不会自动放行所有 vercel.app 地址。
正式域名改动也必须同步该变量并重新部署。

在 Deployments → Create Deployment 部署修复分支。检查构建结果中既有静态资源，也有 api/office/[...path] 函数。
如果目标为正式发布，Production 的 Branch Tracking 必须指向修复分支，或经审核把本补丁合入原部署分支后部署该分支。

## 4. 用 HTTP 验收每一层

在浏览器打开正式域名下 /api/office/snapshot：

| 返回 | 含义与下一步 |
|---|---|
| 404 + 文本 NOT_FOUND | 修复函数未部署/分支不对，查 Source 和 Resources |
| 503 BACKEND_NOT_CONFIGURED | 两个网关环境变量缺失或格式不对 |
| 502 BACKEND_UNAVAILABLE | 检查后端 DNS、HTTPS、进程、网络 |
| 502 BACKEND_INVALID_RESPONSE | 后端返回非 JSON/跳转，核对准确域名和 API 路径 |
| 403 ORIGIN_DENIED | 访问域名与配置不一致，核对前后端各自 origin |
| 401 ACCESS_REQUIRED | 未登录时的正确响应，继续打开 /office 输入访问码 |
| 200 JSON snapshot | 会话建立且业务数据可读取，继续业务验收 |

Vercel Ready 仅表示构建部署就绪，不代表上述 HTTP 或业务检查通过。
浏览器 F12 → Network → 刷新，选择 snapshot 请求，看 Status、Content-Type 和 Response；不要只看页面是否有框架。

## 5. 完整业务验收

在 /office 输入访问码；首页须出现业务数据。进入助手，规则模式分析必须有明确展示。
按角色完成质量任务、开始处理、质量通过、负责人批准、确认发送、采购与销售分别开始并提交回执、负责人关闭。
预览/取消不得执行；相同确认重复提交不得创建重复任务。
刷新后信息不丢；后端重启后使用同一浏览器 Cookie 复查记录。
另一个浏览器是独立演示空间，不能用它判断原空间数据丢失。

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml restart backend
```

确认以上检查成功后再分享正式网址，并说明目前为规则模式、演示角色而非企业真实身份认证。

## 已验证与未验证

- 2026-09-10 本地 npm run test:office：48 项通过。
- 本地 npm run build：TypeScript 和 Vite 构建通过。
- 新增代理集成测试：真实后端、访问码、Cookie、质量到关闭整条链、幂等确认、重启后数据库及助手历史恢复通过。测试用 loopback 代替 TLS 传输，保留生产 Host/Origin 校验。
- 未验证：真实 Vercel 函数打包/路由运行、Docker 镜像构建与服务器卷权限、真实 DNS/HTTPS、线上逐页点击、真实模型调用。
- 本地无 Docker；Vercel 项目读取受阻。以上未测项不得写成已上线。

官方依据：
- https://vercel.com/kb/guide/is-sqlite-supported-in-vercel
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/git
