# agent-learning — 同事一键部署包

Devin 全局记忆 + Lesson 召回 + 错误防复发 Guard 的发行版
（macOS / Linux / Windows Git Bash 均可执行安装脚本）。

## 同事需要做的事（三步）

```bash
# 1. 拿到包（二选一）
#    a) 直接拷贝发行物
tar -xzf agent-learning-1.0.0.tar.gz && cd agent-learning
#    b) 或从仓库克隆（Private repo，需要读取权限）
#      git clone <repo-url> && cd agent-remote-poc/release/agent-learning

# 2. 验证包完整性（可选但推荐；按你的系统二选一）
sha256sum -c ../dist/agent-learning-1.0.0.tar.gz.sha256   # Linux
shasum -a256 -c ../dist/agent-learning-1.0.0.tar.gz.sha256 # macOS

# 3. 安装 + 自检
./install.sh --yes && ./doctor.sh
```

之后重启 Devin Desktop 开新会话即可。异常时：

- `./doctor.sh` 先看哪一项 FAIL/PART（每项都有修复提示）
- `./rollback.sh` 只撤销本包改过的配置（你装后自己加的东西不动）
- `./uninstall.sh` 完整卸载（个人记忆默认保留）

## 发行物完整性

`dist/agent-learning-1.0.0.tar.gz` 由 `release/build-dist.sh` 确定性构建
（`tar --uid 0 --gid 0 --numeric-owner | gzip -n`，macOS 下自动加
`--no-mac-metadata`），同一代码连续两次构建 sha256 一致。复审者可执行
`bash release/build-dist.sh` 复算并与 `dist/*.sha256` 比对。

## 平台范围（如实）

- 脚本已跨平台：仅依赖 bash + Node ≥18，无 OS 专属工具；非 macOS 平台
  警告后继续安装。
- 已验证：macOS arm64 + Node ≥18 + Devin CLI/Desktop 用户级配置
- NOT_TESTED：Intel Mac、Linux、Windows（Git Bash）、其他 agent
  （Codex/Claude Code 等）
- 已知限制：AgentMemory daemon 端口 3111 为硬编码，同一台 Mac 的多用户账户
  无法各自独立运行 daemon——同机试装步骤见 `docs/distribution/INSTALL_UAT.md`。
