# 安装记录（实际执行）

所有命令均在本机 Mac 实际执行；标注 `[RUN]` 为实际运行并验证输出，`[DOC]` 为官方文档步骤
（未执行）。

## 1. 上游版本核对 `[RUN]`

```sh
npm view @deepseek-ai/dsh dist-tags      # latest = 0.2.2-rc.1（Remote 文档兼容基线）
npm view ds-harness-remote dist-tags     # latest = 0.6.5
git ls-remote https://github.com/deepseek-ai/deepseek-harness HEAD
# 39163dd30f703a79079e2d2446545cff3c453738
git ls-remote https://github.com/liguobao/ds-harness-remote HEAD
# e285ec2442d147324f1154f9ed501c786c78767e  (v0.6.5 tag = eef232d2…)
git ls-remote https://github.com/ccch1mneyyy/dsh-Go HEAD
# 20bfc07dd62a687bb1eea97b9c5dc45d0ae538fa
```

选择理由：`0.2.2-rc.1` 是 Remote 官方兼容性文档声明的开发/验证基线
（`docs/compatibility.md`），`0.6.5` 是 README 与 npm 当前正式版。未使用 `next`
tag（0.2.2-rc.3）以避免偏离 Remote 验证范围。

## 2. 安装脚本审查 `[RUN]`

```sh
npm view @deepseek-ai/dsh@0.2.2-rc.1 scripts   # 无 install/postinstall 生命周期脚本
npm view ds-harness-remote@0.6.5 scripts       # 仅 test/build/check
```

未使用 `curl | bash` 类一键脚本。macOS 官方流程（Remote docs/installation.md）本身也
只是复用已有 DSH/Desktop，不安装 DSH 本体。

## 3. 隔离工作区 `[RUN]`

```sh
POC=~/agent-hub-poc
mkdir -p "$POC"/{runtime,dsh-home,workspaces,tools,evidence/logs}
export DSH_HOME="$POC/dsh-home"   # 全程隔离，不使用默认 ~/.dsh
```

未覆盖任何现有 Agent 配置（`~/.claude`、Devin 配置均未修改）。

## 4. 安装 DSH（本地，非全局）`[RUN]`

```sh
cd "$POC/runtime"
npm init -y
npm install --save-exact @deepseek-ai/dsh@0.2.2-rc.1
./node_modules/.bin/dsh --version        # => 0.2.2-rc.1
```

`npm audit` 结果：209 vulnerabilities（8 moderate / 201 high），主要为
`undici`（DoS/SRI/TLS 相关 GHSA）与 `zod <4.6.6`（内存耗尽）在 ~100 个
`@deepseek-ai/dsh-*` 子包中重复计数。未执行 `audit fix --force`（会升级至
0.2.2-rc.3，偏离 Remote 兼容基线）。详见 SECURITY_REVIEW.md。

## 5. 启动 DSH web profile `[RUN]`

```sh
DSH_HOME="$POC/dsh-home" ./node_modules/.bin/dsh web --no-open
# => dsh web: http://127.0.0.1:3080/?token=<local-ui-token>
```

验证：
- `curl http://127.0.0.1:3080/`（无 token）=> `401 Unauthorized`
- 带 token => `303` 正常跳转
- `lsof -iTCP -sTCP:LISTEN`：仅 `127.0.0.1:3080`，无公网监听端口

说明：本机无 DeepSeek Harness Desktop，采用 standalone `web` profile（与官方 Linux
Hosted 流程同构，Remote 文档明确支持该 profile 作为 Host）。`--no-open` 仅为避免
自动弹浏览器。

## 6. 安装 Remote 插件 `[RUN]`

```sh
DSH_HOME="$POC/dsh-home" ./node_modules/.bin/dsh plugin --profile web add -w ds-harness-remote@0.6.5
# => + ds-harness-remote 0.6.5（pnpm v10.33.0，41 packages）
```

peer 警告（`react`、`@deepseek-ai/cordis`、`dsh-settings`、`dsh-api-gateway`）为预期：
这些由 DSH 宿主运行时提供；声明范围 `>=0.2.2-0 <0.2.3-0` 覆盖本机 0.2.2-rc.1。

重启 `dsh web` 后日志（`$DSH_HOME/logs/ds-harness-remote/host.log` 与 stdout）：

```
[ds-harness-remote] host identity ready {"deviceId":"01a1dc9b…3932","fingerprint":"47C2 3346 AA7C","server":"https://dsh.r2049.cn"}
[ds-harness-remote] Codex App Server ready
[ds-harness-remote] Codex Remote domain unavailable {"code":"CODEX_AUTH_REQUIRED"}
[ds-harness-remote] client remote-mode identity ready {"deviceId":"01a1dc9b…e116","fingerprint":"AD49 B024 5829"}
[ds-harness-remote] Cursor ACP ready        # 实际 spawn 的是 claude-agent-acp（见下）
[ds-harness-remote] server control connection failed {"code":"ACCOUNT_AUTH_REQUIRED","status":401}
```

证据要点：
- Host identity 与 fingerprint 真实生成，server 指向 `https://dsh.r2049.cn`
- 设备指纹随 serverUrl 作用域稳定（误配 serverUrl 时指纹不同，恢复后回到
  `47C2 3346 AA7C`）
- `401 ACCOUNT_AUTH_REQUIRED` 证明已真实连通托管服务，仅差账号授权
- `ps aux` 可见插件拉起了 `…/tools/node_modules/.bin/claude-agent-acp` 子进程
  并完成 ACP initialize（"Cursor ACP ready" 是复用 cursor-process 适配器类的日志名）

## 7. Agent 后端工具安装 `[RUN]`

```sh
cd "$POC/tools"
npm install --save-exact @zed-industries/claude-agent-acp@0.23.1 @openai/codex@0.169.0
./node_modules/.bin/codex --version      # => codex-cli 0.169.0
./node_modules/.bin/codex login status   # => Not logged in  => BLOCKED_AUTH
```

`claude-agent-acp` 选用 zed-industries 官方包（npm 上同名 `claude-agent-acp`
是第三方 fork，未采用）。

## 8. 插件配置 `[RUN]`

写入 `$DSH_HOME/profiles/web/cordis.patch.yml`（模板见 CONFIGURATION.md）：

- `serverUrl: https://dsh.r2049.cn`、`role: host`（`config` 为**整体替换**语义，必须重述）
- `acp.backends`: claude → POC 内 `claude-agent-acp` 绝对路径；opencode/pi/antigravity
  关闭；cursor 默认关闭
- `codex.binary` → POC 内 `codex` 绝对路径
- `terminal.enabled: false`（POC 安全约束：远程终端默认关闭，开启需授权）

## 9. 账号授权 `[DOC]`（用户步骤，Devin 不代办）

- Remote 面板 / `ds-harness-remote login`：Zhihu / GitHub / Google OAuth 或账号密码
  （账号注册需邀请码，按 README 需邮件向作者申请）
- `codex login`：ChatGPT 账号或 OpenAI API key
- DSH 模型：`DEEPSEEK_API_KEY` 或 DeepSeek 账号 OAuth（dsh-llm-deepseek-* 包证实仅
  支持 DeepSeek account / api-key / pi-ai 三类 Provider）
- Devin ACP：`authenticate`（`meta.api_key`）或浏览器 PKCE
