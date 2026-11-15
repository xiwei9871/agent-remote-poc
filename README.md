# agent-remote-poc

POC 验证（任务代号 AGENT-HUB-POC-V0.1）：在本地 Mac 上部署 **DeepSeek Harness (DSH) +
ds-harness-remote**，验证统一管理多个原生 Coding Agent（Claude Code / Codex / DSH /
Devin CLI）并从手机或另一台电脑远程接管会话的可行性。

本轮为独立概念验证，不涉及生产部署，不改造现有业务系统。

## 执行环境（实测）

| 项 | 值 |
| --- | --- |
| 主机 | Mac mini, Apple M4 (arm64) |
| OS | macOS 26.7.2 (Darwin 25.6.0) |
| Node.js | v24.14.1（要求 ≥24.9 ✓） |
| 执行者 | 目标 Mac 本地的 Devin CLI/Desktop（非云端沙箱） |
| POC 工作区 | `~/agent-hub-poc/`（隔离 `DSH_HOME`，未污染 `~/.dsh`） |

## 上游与版本（已核实，非 latest）

| 组件 | 版本 | 上游 HEAD / tag |
| --- | --- | --- |
| `@deepseek-ai/dsh` | `0.2.2-rc.1`（npm `latest` dist-tag，恰为 Remote 兼容基线） | repo HEAD `39163dd30f703a79079e2d2446545cff3c453738` |
| `ds-harness-remote` | `0.6.5`（npm `latest`） | tag `v0.6.5` = `eef232d2c43b0c9d04998a18db98cbc9e673e488` |
| `ccch1mneyyy/dsh-Go` | 参考（Android 客户端） | repo HEAD `20bfc07dd62a687bb1eea97b9c5dc45d0ae538fa` |
| `@zed-industries/claude-agent-acp` | `0.23.1` | — |
| `@openai/codex` | `0.169.0` | — |
| Devin CLI（Devin.app 内置） | `3000.12.59` | — |

## 总体结论：`PARTIAL_PASS`

安装与本地 Host 侧全部真实跑通；Claude ACP 适配层握手实测通过；所有远程/账号/模型
相关用例在授权边界处停止并已记录精确阻塞点。**未经真机与账号验收，未声明
POC_PASS。**

| 阶段 | 状态 |
| --- | --- |
| P0 环境与隔离工作区 | PASS（实测） |
| P1 DSH + Remote 插件安装、Host 启动 | PASS（实测，到达账号 401 边界） |
| P2 Claude ACP 接入 | 部分 PASS（握手+spawn 实测；prompt 因上游 Provider 网关无响应阻塞） |
| P2 Codex App Server | BLOCKED_AUTH（CLI 已装，未登录） |
| P2 DSH 原生模型会话 | BLOCKED_AUTH（需 DeepSeek API key/OAuth） |
| P3 Devin `devin acp` | 协议兼容 PASS；会话 BLOCKED_AUTH（ACP 模式强制要求 API key 或浏览器 PKCE，不复用本机凭据）；**上游无 Devin 适配器（代码级确认）** |
| P4 跨设备 R01–R12 | BLOCKED（Remote 账号未登录；手机项生成 UAT 清单） |
| P5 安全/回滚 | 已检查并文档化 |

详见 `docs/` 下各文档与 `docs/TEST_MATRIX.csv`。
