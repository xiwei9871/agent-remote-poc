# 安全审查（POC 范围，非完整审计）

## 1. 供应链与依赖

- `npm audit`（dsh 0.2.2-rc.1 完整依赖树）：**209 项**（8 moderate / 201 high）。
  主要 advisories：
  - `undici`（多个 GHSA：DoS、SRI bypass、TLS 选项丢弃、缓存污染）
  - `zod <4.6.6`（受限集合校验内存耗尽）
  - 同一 advisory 在 ~100 个 `@deepseek-ai/dsh-*` 内部包中重复计数，实际独立风险
    面小于 201。
- 评估：DSH 为 developer preview（官方明示存在兼容性断裂风险）。对隔离 POC 可接受；
  **生产化前必须重新审计**。
- 未执行 `npm audit fix --force`：会升级至 0.2.2-rc.3，偏离 Remote 官方兼容基线。

## 2. 传输与身份

- Remote 宣称：会话流量端到端加密，Server 仅转发密文；P2P 优先，TURN/Relay 兜底；
  Host 只出站不公网监听（`[RUN]` 本机 `lsof` 验证：无公网端口）。
- 设备身份：Ed25519 类指纹（`47C2 3346 AA7C`），按 Server 作用域隔离；移除设备即
  吊销凭据与活动连接（README，未实测移除路径）。
- 元数据边界：路由/在线状态/connectionId 等控制元数据可被服务端看到——**不要把
  敏感仓库接入托管 Relay**；本 POC 仅使用虚拟代码。
- Hosted 与自托管差异（README + docs）：自托管 minimal Server 提供
  WebRTC 协调/加密 Relay，**不含完整 Remote Web**；本轮按任务要求优先托管。

## 3. 权限边界

- POC 显式关闭远程终端（`terminal.enabled:false`）。注意上游默认**开启**，且终端以
  Host 用户运行、不经 Agent 审批——启用须单独授权。
- 远程文件预览只读、有界目录枚举；不暴露通用工具 RPC 与桌面控制（文档+静态一致）。
- ACP/Pi 工具以 Host 用户 OS 权限执行，Remote 仅做单次审批，无额外沙箱——后端
  工作区务必限在 POC 目录。
- 插件 spawn 的 Agent 子进程继承 Host 用户环境（含 PATH、凭据文件可读性）——
  与非 Remote 运行本机 Agent 等价，不算新增风险，但要求工作区隔离。

## 4. 凭据与日志卫生

- DSH_HOME 隔离在 `~/agent-hub-poc/dsh-home`；未写入 `~/.dsh`，未改 `~/.claude`、
  Codex、Devin 任何既有配置。
- `http://127.0.0.1:3080/?token=…` 本地 UI token 与 Host 凭据**不入库**；
  本仓 evidence/ 只含脱敏结论。
- `.credentials.yaml` 含浏览器会话 secret（本机文件权限默认）；迁移逻辑带
  credential-refresh-gate 校验目录归属。
- 用户 claude 网关 token（sk-Gvi…）存在于其自有 settings.json，本 POC 未读取/复制/
  修改其值。

## 5. 已知残余风险

- DSH preview + 201 high advisory：DoS/内存耗尽类为主，暴露面为本机 3080（已鉴权）+
  各 SDK 客户端。
- 第三方 Claude 网关（shenlanqaq.com）为用户既有配置，POC 未验证其安全性。
- Remote 托管服务为社区项目（非 DeepSeek 官方）：账号授权后其拥有设备目录/在线
  状态等元数据；敏感场景应选自托管。
- LexarDev 外置卷为 APFS `noowners`：POC 未使用其存放凭据（DSH_HOME 在系统卷）。

## 6. 未做项（诚实声明）

- 未做渗透/破坏性验证；未验证 E2E 加密的密码学实现（仅文档+行为级核对）。
- 未测试 Linux root 安装路径（macOS 用 user 级流程）。
