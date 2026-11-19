# Agent Learning — Devin 全局记忆与防复发技能包

给 Devin agent 装上**长期记忆 + 经验召回 + 防复发护栏**：装完之后，Devin
会记住以前踩过的坑、在新会话里自动想起相关经验，并对已知的危险操作
（比如广谱 `pkill` 杀进程）在动手前直接拦下。

> 面向同事的使用文档。这是一套 agent 级技能工具组合（Skills + Hooks +
> Guard），不是平台软件——本体跨平台，安装/自检脚本当前的验证范围见
> 「版本与限制」。仓库里的 `docs/`、`release/` 是研发与发行材料，
> 正常使用不需要阅读。

## 一键安装

```bash
git clone https://github.com/xiwei9871/agent-remote-poc.git
cd agent-remote-poc
./install.sh
./doctor.sh
```

- 需要 Node ≥ 18（`node --version` 确认）和已装好的 Devin Desktop/CLI。
- `./install.sh` 会：装固定版本的 AgentMemory（0.9.32）、接好记忆采集
  的 6 条 Hook + MCP、安装 4 条 Guard Hook、放进 7 个 Skills。**装前自动
  备份，失败自动还原，不会动你已有的其他 Hook/MCP/Skill。**
- `./doctor.sh` 逐项自检并给修复提示；全 PASS 即安装成功。
- 装完**重启 Devin**（或开新会话）生效。
- 发行压缩包在 `release/dist/`，可用 `release/build-dist.sh` 复算校验。

## 功能一览

| 能力 | 说明 | 自动吗 |
| --- | --- | --- |
| 长期记忆 | AgentMemory 本地 daemon 记录会话事件，记忆存你自己机器 | 自动采集 |
| 自动召回 | 新会话开始时注入相关历史经验（Lesson/context） | 自动（SessionStart Hook） |
| 7 个 Skills | memory-recall、error-triage、self-repair、lesson-distiller、lesson-validator、evidence-verifier、learning-health | 在会话里按名字调用，如 `/memory-recall` |
| 防复发 Guard | 已知危险操作在 PreToolUse 阶段直接 block（如 E03 广谱 pkill） | 自动拦截 |

## 使用示例

- **召回验证**：开个新会话，问 Devin"我们之前对 XX 问题怎么处理的？"——
  有记忆时它能引用历史结论（记忆库为空时召回为空属正常）。
- **Guard 验证**：让 Devin 执行类似 `pkill -f python` 的广谱杀进程命令，
  会被 `decision: block` 拦下；普通命令（`ls`、`npm test`）正常放行。
- **查健康**：随时跑 `./doctor.sh`。

## 常见问题

- **安装失败**：安装器会自动把配置还原到安装前状态（包括"原本没有
  配置文件"的情形），看终端里的 FAIL 行修复后重跑即可，重复执行幂等。
- **记忆不生效 / daemon 不可达**：`agentmemory status` 检查 daemon；
  `agentmemory` 命令可手动拉起。注意：同一台 Mac 只支持**一个**主要
  AgentMemory 使用账户（3111 端口为机器级共享）。
- **`Hook failed` / `MODULE_NOT_FOUND`**：`./doctor.sh` 的"悬空检查"会
  找出指向已删除脚本的 Hook——这正是本包用稳定目录 `~/.agent-learning/`
  替代仓库路径要解决的问题。
- **同名 Skill 冲突**：你原有的同名 Skill 会先被备份到
  `<名字>.pre-agent-learning-*`，卸载时自动还原；你改过的包内 Skill
  会被保留为 `*.user-modified-*`，绝不硬删。

## 升级与卸载

```bash
./rollback.sh    # 只撤销本包改过的配置（你装后新增的内容保留）
./uninstall.sh   # 完整卸载；个人记忆默认保留
```

- 更新：拉取仓库新版本后再跑一次 `./install.sh`（幂等）。
- 删除记忆数据：`./uninstall.sh --purge-data`，需输入 `DELETE-DATA` 确认。
- AgentMemory 本体默认保留：`./uninstall.sh --remove-agentmemory` 连它
  一起卸（仍 `--keep-data`）。

## 版本与限制

- 版本：发行包 **1.0.0**（钉死 `agentmemory@0.9.32`）。
- 包的本体（7 个 SKILL.md、guard/session-context 的 Node 脚本、策略
  JSON）是纯文件与 Node 代码，没有平台特定逻辑。
- **安装/自检脚本已跨平台**：install/doctor/rollback/uninstall 只依赖
  bash + Node ≥18（哈希计算全部走 Node，无 `shasum`/`sha256sum` 等
  平台工具），macOS / Linux（Ubuntu、Red Hat 等）/ Windows Git Bash
  均可执行；非 macOS 平台给出警告但继续安装。
- **已验证**：macOS **arm64** 上完整安装/自检/回滚/卸载，E03 阻断实测
  生效。
- **未验证**：Linux、Windows（Git Bash）的真实运行——脚本可移植但尚无
  真机 UAT，doctor 会在异常时如实 FAIL。其他 Agent（Codex/Claude Code
  等）也不在支持范围。
- **实验功能**：自动纠错→自动沉淀 Lesson→跨会话防复发的闭环目前标记
  EXPERIMENTAL，未纳入稳定承诺。
- 已知边界：AgentMemory daemon 端口 3111 硬编码——同一台机器多账户会
  共享 daemon，请每台机器只用一个主要账户运行本系统。
