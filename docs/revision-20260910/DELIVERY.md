# 本轮验证与交付

## 实际交付状态

已完成源码修改与分步本地 Git 提交。GitHub 读取成功，写入失败：当前运行环境没有该仓库 HTTPS 登录凭据（could not read Username）。没有成功推送，也没有更新原公网预览地址。

本地浏览器预览被环境阻止（ERR_BLOCKED_BY_CLIENT），因此没有声称完成页面点击、截图或移动端视觉验收。真实模型缺少私有配置，未做真实供应商接口调用；模型协议测试使用本地测试服务。

## 验证记录

- 修改前后端基线测试：43 项。
- 本轮后端测试：46 项通过，0 失败；包括 A/B 闭环、选择不自动批准、批准不发送、发送预览取消无副作用、发送岗位限制、未发送不能开始或提交回执、单方发送失败与重试不重复、接收与开始区分、任意顺序双回执、未齐不能关闭。
- 原角色隔离、数据版本校验、幂等确认、SQLite 重启恢复、旧状态迁移、来源/关系一致性测试保持通过。
- 新增反馈查询不改变事项、历史结构化事实不随新版本改写、可选理由依据实际 D9/D4 数据生成测试通过。
- TypeScript、定向 ESLint、生产构建与 git diff --check 通过。
- 响应式 CSS 已实现但 1440/1280/390px 视觉验收未执行。刷新/前进后退/输入区定位/弹窗取消等浏览器操作仍需人工验收。

## 如何查看源码差异

```bash
git log --oneline office-demo-baseline-20260910..codex/office-demo-20260910-revision
git diff --stat office-demo-baseline-20260910..codex/office-demo-20260910-revision
git diff office-demo-baseline-20260910..codex/office-demo-20260910-revision -- src/features/office/assistant.tsx
```

原码通过标签查看；修改码通过独立分支查看。可以用 GitHub Desktop 的 History 看每次提交，用 Changes 看未提交改动。不要把 Download ZIP 当作带 Git 历史的仓库；交付包内另附 Git bundle，保留原始历史和新提交。

## 从交付包恢复完整仓库并推送

在解压交付包的文件夹打开 Git Bash：

```bash
git clone -b codex/office-demo-20260910-revision longsheng-office.bundle longsheng-office
cd longsheng-office
git remote set-url origin https://github.com/Ksaveworld/longsheng-office.git
git push -u origin codex/office-demo-20260910-revision
git push origin refs/tags/office-demo-baseline-20260910
```

推送会使用你本机正常 GitHub 登录；需要对 Ksaveworld/longsheng-office 有写权限。不要在聊天中发送密码或访问令牌。新分支推送会一次保留全部分步提交。推送前先由 GitHub Desktop Fetch 或 git fetch 核对同事是否有新提交；不要强推或覆盖原分支。

推送成功后，在 GitHub 切换到修改分支，打开提交历史查看每一步；Compare 选择原 handoff 分支为 base、修改分支为 compare，即可查看差异。合并和替换线上服务仍未执行。

## 最终 Demo 怎么看

最快：解压 `modified-source.zip`，安装 Node.js 24，双击 `start-demo.cmd`，等待服务启动后打开 README 中的本地地址。保持启动窗口运行。

Git Bash 也可按 README 运行。已有公网地址目前仍是旧部署；要让销售通过原链接看到新版，需要由有服务器权限的维护人员按 README 的 Docker/反向代理方式发布，保留 SQLite 和 config.key 备份。发布后依次走 A/B 两链，并确认目标服务器实际运行的提交号。

## 发布前必须补验

1. 首页只预填问题不发送；首屏无方案与回执。
2. 发送影响问题只出现相关结果；点击来源并关闭后保留对话。
3. 新建/切换历史、切角色、刷新、浏览器前进后退，草稿与事项 ID 正确。
4. A/B 无理由可选；取消选择、取消发送、取消反馈不改状态。
5. B 核验与两部门接收/开始/回执的按钮顺序正确；批准后仍待发送。
6. 一方失败可重试；两份回执齐全后负责人关闭，首页已办结和列表记录一致。
7. 1440/1280/390px 无溢出、关键按钮可见；高级图谱默认折叠。

## 需求中仍待补充的内容

- 新增两个业务场景尚未定义，本轮不编造；首页计数仍来自唯一真实演示事项，岗位待办也不填假数量。
- “都不满意”的规则模式只能重新梳理既有事实；若要求真正生成新方案内容，应配置真实模型并以产品约束验收。
- 方案质量评价标准继续沿用既有人工条件；未发明评分规则。
- 对话消息组与草稿在当前浏览器会话内恢复，后端长期保存每次问答。跨设备完整会话分组恢复不是本轮已实现能力。
