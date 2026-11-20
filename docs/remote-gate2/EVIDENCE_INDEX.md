# Gate 2 证据索引

| 文件 | 内容 | 类型 |
| --- | --- | --- |
| `evidence/host-auth-tail.log` | host.log 尾部：401→authorized→connection online×3 | ACTUAL_RUN |
| `AUTH_AND_PAIRING.md` | 三条授权链 + 授权路径对比 + 控制面发现 | ACTUAL_RUN+STATIC |
| `BASELINE.md` | 版本/身份/进程/会话清单 | ACTUAL_RUN |
| `CLIENT_CAPABILITY_MATRIX.md` | Web/dsh-Go 能力差异 | STATIC+OWNER_VERIFIED |
| `TEST_MATRIX.csv` | 用例状态 | 汇总 |
| `SECURITY.md` / `ROLLBACK.md` | 安全边界/回滚步骤 | DOC |

## 未入库但已发生的 Owner 侧事实（需 Owner 确认）

- Remote Web 设备列表出现 `xiweis-Mac-mini.local`（在线，LAN 已连接）
- 工作区 `default-workspace` 列出既有会话"未命名会话"
- dsh-Go「远程主机→扫码配对电脑」灰置（需 DeepSeek 登录+本地引擎）

状态：`HOST_READY_WAITING_OWNER`（Gate B/C 待真机续测）。
