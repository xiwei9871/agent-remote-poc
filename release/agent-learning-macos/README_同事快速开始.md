# Agent Learning — 同事快速开始（macOS + Devin）

让 Devin 在新会话里自动记起你纠正过的错误，并拦截已知的高风险操作。
3 步完成，全程不需要读内部文档。

## 你需要准备

- macOS（Apple Silicon 已验证；Intel 未测试）
- Node.js ≥ 18（`node --version` 能看到即可，不需要 sudo）
- Devin CLI / Desktop 已登录过一次

## 3 步安装

```bash
# 1. 解压安装包后进入目录
cd agent-learning-macos

# 2. 看一眼将要改什么（可选，不写任何东西）
./install.sh --dry-run

# 3. 正式安装并自检
./install.sh --yes
./doctor.sh
```

看到 `RESULT: PASS` 或 `RESULT: PARTIAL`（带说明的限制项）即完成。
之后**新开一个 Devin 会话**即自动生效，无需任何手动配置。

## 安装后你获得的能力

| 能力 | 状态 |
| --- | --- |
| Devin 全局长期记忆（AgentMemory，本地存储） | 稳定 |
| 新会话自动召回已验证的历史 Lesson | 稳定 |
| E03 等高风险操作确定性阻断（Guard） | 稳定 |
| 7 个配套 Skills（`/memory-recall` 等） | 已安装 |
| 自动从纠错中生成新 Lesson | **实验性** —— 会生成候选草稿并请你确认，不会静默写入 |

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `./doctor.sh` | 自检：记忆、门禁、hooks、技能是否真正生效 |
| `./rollback.sh` | 把 Devin 配置恢复到本包修改前 |
| `./uninstall.sh` | 卸载本包（**默认保留**你的个人记忆数据） |

## 你需要知道的两件事

1. **你的记忆是你的**：所有数据只存在你自己 Mac 的 `~/.agentmemory/`，
   不与任何人共享，本包不包含他人的历史数据或密钥。
2. **已知限制**：Devin 日志里偶发的 `hook exit 1` WARN 是 Devin 内部的
   未归因告警（非本包 hook），doctor 会如实报告而不掩盖。

## 出问题？

先看 `./doctor.sh` 的 FAIL 行和修复建议，或查 `docs/TROUBLESHOOTING.md`。
