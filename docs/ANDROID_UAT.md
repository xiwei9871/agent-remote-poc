# 人工验收清单（手机 / 第二台电脑）

Devin 无法操作实体手机。以下步骤需真人执行并回填结果；任何一步未实测即保持
`BLOCKED`/`NOT_TESTED`，不得标记 PASS。

## 0. 前置（一次性）

- [ ] Host（本机）保持运行：`DSH_HOME=~/agent-hub-poc/dsh-home
      ~/agent-hub-poc/runtime/node_modules/.bin/dsh web --no-open`
- [ ] 在 Host 本机浏览器打开日志中的 `http://127.0.0.1:3080/?token=…`
- [ ] **Remote 登录**（二选一）：
  - 推荐：Remote 面板选 GitHub/Zhihu/Google OAuth 授权；
  - 或账号密码（注册需邀请码，按 README 邮件联系作者）。
  - 成功后 host.log 应不再出现 `ACCOUNT_AUTH_REQUIRED`，Host 对客户端可见。
- [ ] **设备指纹确认**：在客户端与 host.log 核对 fingerprint（当前
      `47C2 3346 AA7C`）。
- [x] Codex：隔离 `CODEX_HOME`+shenlan provider 已通（无需官方登录；Remote 域 ready）
- [ ] Claude：修复 Provider——shenlan `claude-pro` 组对该 token 全模型 403；
      需网关侧开通该组，或提供 Anthropic 直连 key / 有余额的 z.ai 账号。
- [x] DSH 原生：pi-ai→shenlan `gpt-6.1-sol` 已通（headless 实测修 bug OK）
- [ ] Android 客户端（二选一或都测）：
  - 官方 APK：github.com/liguobao/ds-harness-remote/releases/latest
  - dsh-Go：github.com/ccch1mneyyy/dsh-Go releases

## 1. Remote Web（第二台电脑/另一浏览器）R01–R02, R11

- [ ] R01 打开 `https://dsh.r2049.cn` → 登录同账号 → 设备列表出现本 Host（在线、
      指纹一致）→ 可发现 `agent-hub-poc` 工作区。
- [ ] R02 打开一个已存在的 DSH 会话，上下文与历史完整，不要求重建。
- [ ] R11 保持 Web 连接的同时用手机连接同一 Host，两端状态一致、操作互不串线。

## 2. Android App R03–R08, R12

- [ ] R03 手机 App 登录同账号 → 选中 Host → 看到一个**正在运行**的 Agent 会话，
      状态为真实执行中（非完成态假象）。
- [ ] R04 手机向该会话发送追加指令 → Host 端日志/UI 中 Agent 正确收到并继续。
- [ ] R05 让 Agent 执行一个需审批的操作 → 手机弹审批 → 批准后 Host 端实际执行；
      拒绝则不执行。
- [ ] R06 同时开 Claude 与 Codex 两个会话，分别发指令 → 各自上下文独立、不串线。
- [ ] R07 电脑发一条 → 手机接着发 → 历史与状态两端一致。
- [ ] R08 手机切飞行模式 10s 后恢复 → 会话不丢、历史可滚动回读；执行中任务在
      Host 上继续。
- [ ] R12 会话运行中把 App 切后台 ≥1 分钟 → 回前台：仍显示"运行中"，不错误
      显示已完成。

## 3. Host 生命周期 R09

- [ ] 停止 `dsh web`（Ctrl-C 或 kill），重新启动 → 工作区、会话历史、设备授权
      均可恢复；记录不能恢复的项。
- [ ] 若出现端口占用/僵尸：确认无残留 `node` 子进程（`pgrep -fl 'dsh|claude-agent'`）。

## 4. 模型切换 R10

- [ ] 在一个会话内切换模型 → 另一会话模型与运行不受影响。

## 5. 安全抽查

- [ ] 远程文件预览：能看工作区文件，但不能写/删/执行；目录列举有上限。
- [ ] 远程终端：POC 默认关闭——客户端应看不到可用终端（或明确禁用提示）。
- [ ] 退出登录/移除设备后：该设备立即失去 Host 访问。

## 回填模板

| ID | 结果(PASS/FAIL) | 实际现象 | 截图/日志 |
| --- | --- | --- | --- |
| R01 | | | |
| … | | | |
