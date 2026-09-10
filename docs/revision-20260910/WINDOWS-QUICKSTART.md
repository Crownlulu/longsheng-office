# Windows 手把手运行与推送指南

## 你先记住这三件事

- Git / Git Bash 用于下载和上传代码；Node.js 用于运行这个 Demo，二者都需要。
- 本地 Demo 是在你电脑上运行。这里不能直接给你的 Windows 安装软件，只能准备好项目启动配置。
- 你的仓库是 https://github.com/Crownlulu/longsheng-office 。本次推送仍被当前环境缺少 GitHub 登录凭据阻塞，fork 本身不传递你的登录状态。

## 第一步：安装 Node.js 24 LTS

打开 https://nodejs.org/en/download ，选择 24 LTS、Windows、与你电脑匹配的架构（常见 Intel/AMD 电脑用 x64），下载 Windows Installer（.msi）。按安装向导完成，保留 npm 和添加到 PATH 的默认选项。

关闭已有 Git Bash 窗口，再新开一个，逐行执行：

```bash
node -v
npm -v
git --version
```

预期：node 显示 v24 开头；npm 和 git 均显示版本号。不要复制终端前面的 `$`。若提示 command not found，重开终端；仍不行时重新检查 Node 安装。

## 第二步：解压交付包

完整解压 `longsheng-office-windows.zip`，打开其中 `longsheng-office` 文件夹。这里应能看到 `start-demo.cmd`、`package.json`、`src`、`server`。不要在压缩包预览窗口直接运行，也不要将文件覆盖到同事已有工作目录。

## 第三步：双击启动

双击 `start-demo.cmd`。它会依次：

1. 检查 Node.js 24。
2. 联网安装锁定版本的依赖。
3. 编译前端。
4. 启动本地 Node 后端与 SQLite 数据库。
5. 在服务准备好后打开默认浏览器。

看到 `DEMO READY: http://127.0.0.1:5194/office` 即表示服务已启动。如果浏览器未自动打开，手动复制这个地址到浏览器地址栏。

请保持命令窗口打开；关闭窗口后网页无法继续请求后台。停止时按 Ctrl+C；下次再双击启动。首次安装依赖的速度取决于网络。

也可在该文件夹空白处右键“Open Git Bash here”，执行：

```bash
npm run demo:local
```

该启动器明确使用规则演示，不需要 API Key。数据保存在 `.office-data/local-demo/office.sqlite`，下次继续保留。不要删除 SQLite 或 config.key 来修复普通页面问题。

## 第四步：点通 Demo

1. 首页点“继续处理”，问题只预填；你再点“发送问题”。
2. 点“比较供应方案”，选择 B，补充理由可空，确认选择。
3. 发起方案质量核验并确认；右上切质量负责人。
4. 确认接收、开始处理、填写核验凭据并提交通过结论。
5. 切业务负责人，批准 B。此时采购/销售任务仍待发送。
6. 点“确认并发送任务”，在确认框里确认发送。
7. 分别切采购、销售岗位，确认接收、开始处理、填写回执并确认提交。
8. 切业务负责人复核关闭，在首页查看已办结。

A 方案可以跳过 B 的核验，但仍要负责人批准、发送两条任务、两份回执和最终复核。办结只表示办公协同完成，不代表实际到货或交付。

## 第五步：把完整提交推到你的 fork

交付包内的 `git-history.bundle` 包含原始版本、修改分支和逐步提交。ZIP 源码本身没有 `.git`，不能直接 git push。先恢复带历史的仓库。

在解压后的 `longsheng-office` 文件夹打开 Git Bash，逐行执行：

```bash
git clone -b codex/office-demo-20260910-revision git-history.bundle ../longsheng-office-git
cd ../longsheng-office-git
git remote set-url origin https://github.com/Crownlulu/longsheng-office.git
git push -u origin codex/office-demo-20260910-revision
git push origin refs/tags/office-demo-baseline-20260910
```

如果 `longsheng-office-git` 已存在，先换一个新的文件夹名称，不删除已有目录。遇到 GitHub 登录提示，使用正常的浏览器登录，选择 Crownlulu；不要把密码或 Token 发到聊天里。若没有弹出登录，先在 GitHub Desktop 的账号设置中登录，然后 Add Local Repository 选择刚恢复的 `longsheng-office-git`，再 Publish branch / Push origin。

推送目标是新的修改分支，不覆盖 main。若提示权限或 non-fast-forward 错误，保留错误截图，不使用 --force。

成功后打开你自己的 GitHub 仓库，在左上分支选择器切到 `codex/office-demo-20260910-revision`，看最新提交标题；点提交可查看改动文件。原始源码固定在 `office-demo-baseline-20260910` 标签。

## 常见错误

| 现象 | 处理 |
| --- | --- |
| node 不是 v24 | 安装 Node 24 LTS 后重开终端 |
| 下载依赖失败 / ETIMEDOUT | 检查联网后再次启动；保留具体错误，不修改锁文件 |
| Port 5194 is busy | 关掉之前的 Demo 服务窗口再启动 |
| 浏览器显示无法连接 | 等待 DEMO READY；检查命令窗口是否已关闭 |
| Windows 隐藏了 .cmd 后缀 | 在资源管理器开启“文件扩展名”，选择 Windows 命令脚本 start-demo |
| PowerShell 阻止 npm.ps1 | 使用 Git Bash 或直接双击 start-demo.cmd |
| git push 提示 Username / Authentication failed | 当前 Git 尚未登录 GitHub；通过 GitHub Desktop 或 Git 的正常登录流程处理 |

## 这里已经验证和还没验证的内容

运行环境：Node 24；依赖安装、构建、46 项后端测试在本次工作环境中验证。Windows 启动器的 .cmd 调用已按 Windows 方式编写，但本环境是 Linux，尚未在你的 Windows 上实测。浏览器 UI 仍需按上方链路实际点击验收。

本地运行无需 Docker。Dockerfile 已对齐 Node 24，仅供后续服务器部署使用；本轮没有构建 Docker 镜像，也没有更新原公网预览地址。

本次启动器验收：以 `--verify` 在独立测试数据库执行完整依赖安装、构建、启动，前端 HTML、SUP-001 后端接口和无密钥规则模式均返回成功。测试端口为 5196；你本机默认仍为 5194。该检查验证服务启动，不等于 Windows 浏览器视觉验收。
