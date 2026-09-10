# 龙盛办公协同 Demo

2026-09-10 改版：办公协同总览、渐进式业务助手、事项列表与详情。沿用 React / TypeScript / Vite / Shadcn UI、Node.js 24 和 SQLite。保留原爱化身品牌与高级关系视图。

## 先看本轮状态

本轮说明见 [实施记录](docs/revision-20260910/IMPLEMENTATION.md)、[验证与交付](docs/revision-20260910/DELIVERY.md)，原始修改要求见 [产品方案](docs/revision-20260910/PRODUCT-REQUEST.md)。旧版发布/验收说明保存在 docs，其结论不代表本轮已经发布。

原始代码：标签 `office-demo-baseline-20260910`（`ceb7aa5bff249b9e01af3d07c2bb740431f9023f`）。修改代码：分支 `codex/office-demo-20260910-revision`。无需将两套 src 放进同一构建目录。

## 本地运行

需要 Node.js 24 与 npm。在 Git Bash / macOS / Linux 项目目录运行：

```bash
npm ci
npm run build
OFFICE_MODEL_MODE=rules npm run office
```

Windows 用户也可双击项目中的 `start-demo.cmd`。它明确使用规则演示，并将演示数据保存在独立数据库 `.office-data/revision-demo.sqlite`。

打开 http://127.0.0.1:5194/office 。该地址指运行代码的电脑，不是公开分享地址。

`OFFICE_MODEL_MODE` 仅决定新演示空间的默认模式，已有空间保持原配置。真实模型使用 `.env.example` 所列环境变量配置后，以 `node --env-file=.env server/office-server.mjs` 启动；默认 live，失败明确报错，不自动切换规则。原内部 `/api/office/model` 配置 API 保留，客户界面无设置页、模型地址和密钥输入。

## 演示顺序

1. 首页“继续处理”只预填问题；发送后出现对应回答和来源。
2. 点击“比较供应方案”或查询后的“继续比较并选择方案”。选择 A/B，系统带出依据，补充理由可空；弹窗取消不会保存选择。
3. A：负责人确认保留到料风险及跟进。B：发起方案质量核验，切质量岗位，确认接收、开始处理、提交结论与凭据，再切业务负责人批准切换。
4. 批准后两条部门任务先待发送。负责人点击“确认并发送任务”，核对后确认发送。
5. 分别切换采购、销售岗位，确认接收、开始处理、提交回执；顺序不限。失败只重试原任务。
6. 两份回执齐全后，业务负责人最终复核关闭，回到首页查看已办结。
7. 导航“事项详情”先进入列表，可按关键词/状态筛选；从助手进入直接显示当前事项。详情底部返回同一助手上下文。

“都不满意”收集反馈并复用当前模型通道重新分析，不改变业务状态。规则模式仅梳理已知 A/B 方案，不能凭空生成第三供应商、价格或日期。历史回答与来源保持查询当时版本；新回答还保存结构化事实快照。

## 检查

```bash
npm run test:office
npm run build
```

本轮新增发送/接收及历史快照回归见 `tests/office-revision.test.mjs`。原 `scripts/verify-office-workflow.mjs` 针对旧八步页面编写，不能用于证明本轮新界面已通过浏览器验收；本轮实际检查与未测项见 DELIVERY.md。

## 部署

本项目需同时运行 Node 后端和 SQLite，不能只把 dist 上传至静态托管。现有 Docker 与反向代理方式保留：

```bash
npx tsc -b
npx vite build --base=/longsheng-office/
docker build -f deploy/Dockerfile -t longsheng-office:20260910-revision .
```

生产运行需 `OFFICE_PUBLIC_ORIGIN`、私有 `OFFICE_ACCESS_CODE`、`OFFICE_BASE_PATH=/longsheng-office/`，代理去掉路径前缀，Vite base 与后端配置一致。SQLite 和 `config.key` 必须一起备份。实际服务器发布需该服务器的现有发布权限；推送 GitHub 不等于线上 Demo 更新。

## 边界与署名

当前只有供应商交期变更这一已确认场景。两订单、两供应商和会议记录为合成样例。前端岗位切换、收件箱投递和回执均为演示；未接入企业身份、OA、ERP 或外部消息。方案质量核验沿用现有人工核验及凭据条件，未新增评分标准。办公事项关闭不代表实物到货、生产完成或订单交付。

界面基于 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)，保留 MIT 许可证与署名。上游基线为 `e16c87f213a5ba5e45964e9b67c792105ec74d26`。爱化身名称与 Logo 用于演示标识；本仓库不授予商标权利。依赖项各自许可证继续适用。
