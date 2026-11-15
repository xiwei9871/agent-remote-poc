# Devin 认证状态矩阵（实测）

三种独立认证，互不复用：

| 状态 | 存储 | 检测命令 | 本机现状 |
| --- | --- | --- | --- |
| CLI 登录 | `~/.local/share/devin/credentials.toml`（`windsurf_api_key` 189 字符等） | `devin auth status` | **"Not logged in"**——但 ACP 无 ACP_BACKEND 时回退使用同一文件成功建会话，说明 key 仍被 API 接受（status 检查可能校验更新格式/刷新令牌） |
| ACP Host 认证 | 进程内，不落盘 | `authenticate` RPC | 每次 spawn 由 Host 调用 `authenticate` 提供 |
| 浏览器 PKCE | Devin 账号侧会话 | 浏览器回调 | `authenticate{methodId:"devin-browser"}` 的一种方式，不是独立凭据 |

## 根因：`ACP_BACKEND` 环境变量（二进制字符串实证）

- `ACP_BACKEND=windsurf`（Devin Desktop 注入其子进程）→
  *"ACP host is the sole source of credentials. Local CLI credentials … will
  NOT be used. Waiting for the ACP host to call `authenticate`."*
- `ACP_BACKEND` 未设置 →
  *"Will accept host credentials if provided, otherwise fall back to env vars
  and stored CLI credentials."*

→ 之前反复弹浏览器 = 每次 spawn（Desktop 环境注入 ACP_BACKEND）+ driver
无条件 `authenticate{devin-browser}` 双重触发，非凭据失效。

## 复用验证（零浏览器，连续真实会话）

`env -u ACP_BACKEND` + `ACP_SKIP_AUTH=1`（driver 不调用 authenticate）：

| 会话 | 结果 | 证据 |
| --- | --- | --- |
| tropical-perigee | `ls` → S1_DONE | evidence/noauth-s1.jsonl（脱敏后） |
| grateful-heliotrope | `uname -m` → S2_DONE | noauth-s2 |
| grass-tree | `date +%Y` → S3_DONE | noauth-s3 |
| resilient-legal（更早探针） | session/new 直接成功 | 日志 |

4 会话零 authenticate、零浏览器、全部执行只读任务——**满足"连续三个新
Session 无新登录"验收**。

## 残余问题

- `devin -p`（交互 REPL）仍要求 `devin auth login`——REPL 走 CLI 凭据链且
  status 判负；与 ACP 回退路径不是同一校验逻辑。**`devin auth login` 不是
  ACP 复用的前提**，之前判断有误，修正。
- ACP 会话里 hooks/MCP 仍全局加载（10 hooks + agentmemory MCP 已实测）——
  记忆/门禁系统与认证路径无关，未被本次改动影响。
