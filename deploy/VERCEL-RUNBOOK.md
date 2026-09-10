# 龙盛 Demo：Vercel + Neon 部署手册

本文件取代本分支早期的“另租服务器 + Docker 后端”路线。
现用结构：Vercel 提供网页与 `/api/office/*` 业务函数，Neon PostgreSQL 保存数据。
原来的 `npm run demo:local` 仍使用本机 SQLite；Docker / Caddy / proxy 文件仅作为旧方案保留，本次不用配置它们。

## 为什么之前 Ready 仍报错

之前的线上 `/api/office/snapshot` 实测返回 404 文本 NOT_FOUND。
前端将其当作 JSON 读取，因而出现 INVALID_RESPONSE。`npm run build` 仅打包网页，旧版缺少业务函数入口。
本次将 API、会话、业务状态、操作预览、幂等确认与助手记录接入 PostgreSQL。
同一会话的请求使用 PostgreSQL 事务级 advisory lock 防止多实例并发覆盖；状态与确认记录在同一事务提交，失败一起回滚。

## 当前已完成的用户配置

- 账户空间：lzk3320789-5817（不需要寻找名为 longsheng-office 的团队）。
- 项目：longsheng-office。
- 正式网址：https://longsheng-office.vercel.app/office。
- 源码修复分支：codex/vercel-backend-deployment-fix。
- Neon：longsheng-office-db，已关联项目 Production 和 Preview。
- 已有 DATABASE_URL。其余 DATABASE_* 变量可以保留；程序只读取 DATABASE_URL。

## 1. 更新本地代码

保持 Clash Verge 和已经能登录 Vercel 的 Git Bash 窗口运行。在本地修复仓库目录逐行执行：

```bash
git pull --ff-only
bash scripts/configure-cloud-demo.sh
```

脚本通过已经登录的 Vercel CLI，将下列四项加入 Production 和 Preview。
数据库密码不需要复制，也不需要发给助手。

| 变量 | 作用 |
|---|---|
| OFFICE_ACCESS_CODE | 自动生成的网页演示访问码 |
| OFFICE_CONFIG_KEY | 自动生成的稳定加密密钥，保护空间内保存的模型凭据 |
| OFFICE_PUBLIC_ORIGIN | https://longsheng-office.vercel.app |
| OFFICE_MODEL_MODE | rules，使用现有规则演示，不需要模型 API 密钥 |

脚本只新增变量，不强制覆盖已有值。成功显示 CLOUD CONFIG READY。
遇到错误脚本立即停止；保留 `.runtime/cloud-setup` 可继续使用相同密钥并跳过已成功项。
不要删除密钥再重新生成：数据库中已加密的模型凭据依赖原密钥。
这些文件已排除在 Git 与 Vercel 上传范围之外。

## 2. 先部署预览版本

```bash
npx vercel@59.15.1 deploy --yes
```

这条命令上传当前目录代码、在 Vercel 安装依赖并构建；无需先在 Windows 运行 npm ci。
它创建 Preview，暂不改变正式域名。记录命令输出的预览网址。

构建配置已写入 vercel.json：Vite、npm ci、npm run build、dist、US East iad1、函数时限150秒。
项目 Node 版本保持24.x。数据库区域与函数同在US East。

## 3. 预览验收

打开刚生成的预览网址，在末尾加 `/office`。如果 Vercel 要求登录，使用当前 Vercel 账号；不要关闭部署保护来绕过此步骤。
在 Git Bash 查看本次自动生成的网页访问码：

```bash
cat .runtime/cloud-setup/OFFICE_ACCESS_CODE
```

将显示的访问码填入网页。不要把访问码截图发进聊天。
首次请求自动建表并建立独立演示空间。

检查首页出现事项与待办；助手可以用规则模式回答供应商延期问题；刷新后历史仍在。
进一步完成质量核验、负责人批准、单独确认发送、采购和销售分别开始处理并回执、关闭事项。
取消预览不执行；重复确认不生成重复任务。
不同浏览器的 Cookie 对应不同演示空间，数据不同属于原有设计。

| API 状态 | 含义 |
|---|---|
| 401 ACCESS_REQUIRED | 未输入访问码时正常，说明 API 与数据库已响应 |
| 503 CLOUD_NOT_CONFIGURED | 必需变量缺失或加密密钥不是64位十六进制 |
| 500 DATABASE_OR_SERVER_ERROR | 查函数运行日志，可能数据库网络、权限或 SQL 错误 |
| 403 HOST_DENIED / ORIGIN_DENIED | 核对访问域名；预览使用 VERCEL_URL / VERCEL_BRANCH_URL 系统变量 |
| 409 MODEL_BUSY | 同一空间有另一个请求正在处理，稍后重试 |
| 404 文本 NOT_FOUND | 未部署到包含 API 入口的代码，检查部署 Source / Resources |

不要只截取 Ready。错误时保留部署 URL，并在 Vercel 的对应部署 Logs 中查看出错请求。
密钥、数据库连接串和 Cookie 不要贴到聊天。

## 4. 发布正式版本

预览业务验证通过后，在同一目录执行：

```bash
npx vercel@59.15.1 deploy --prod --yes
```

这次使用 Production 变量并更新正式域名。再访问正式 `/office` 验证登录、事项、助手与刷新。
Production 与 Preview 的浏览器 Cookie 分开，正式登录会建立正式域名自己的演示空间。

后续 Git 自动发布时，Production Branch 应为 codex/vercel-backend-deployment-fix；否则推送原分支可能重新发布旧代码。
CLI `--prod` 可以发布本次代码，但不会自动修改 Git 的分支追踪设置。

## 验证记录及边界

- 本地原业务测试与新增 PostgreSQL 测试通过，前端 TypeScript/Vite 构建通过。
- 新测试使用 PGlite 的 PostgreSQL 引擎：完整业务链、幂等确认、失败回滚、数据库重开恢复、空间隔离、加密凭据与登录限流。
- PGlite 测试不是 Neon 网络验证，也不代表多个 Vercel 实例的并发实测。
- 真实 Vercel 打包、Neon 网络连接和线上逐页点击，要以第2至4步实际结果为准。
- 本轮是规则模式 Demo；没有声称验证真实模型。岗位切换是演示权限，不是企业身份认证。
- 两种部署环境连接同一演示数据库，适用于当前合成演示数据。正式业务上线前需单独规划数据、身份与访问范围。

参考：[Vercel CLI 环境变量](https://vercel.com/docs/cli/env)、[PostgreSQL 事务](https://node-postgres.com/features/transactions)。
