# 客户端能力矩阵（STATIC + 部分 ACTUAL_RUN）

| 能力 | Remote Web（浏览器） | dsh-Go（Android） | 证据 |
| --- | --- | --- | --- |
| 账号登录（zhihu/GitHub/Google OAuth） | 是（Owner 已登录） | 是（"远程主机"页有同三个 OAuth 按钮） | Owner 截图 |
| 设备列表/选择工作电脑 | 是（"刷新设备列表"→ `xiweis-Mac-mini.local` 在线） | 待真机验证 | OWNER_VERIFIED 截图 |
| Host 设备配对码扫描 | **不支持**——`/pair` 页仅提示用手机扫 | **支持但有前置**：「扫码配对电脑」要求先登录 DeepSeek 账号，且 DeepSeek 登录要求手机装本地运行引擎 | ACTUAL_RUN（网页）+ OWNER_VERIFIED（手机灰置） |
| 远程主机一次性注册码路径 | 有（设备页底部 install 命令内嵌 `XXXX-XXXX` 码，~7:40 一次性） | n/a（Host 侧消费） | ACTUAL_RUN |
| 邮箱+密码登录 | Host 侧 `host.account.login` 存在 | "自建服务器·邮箱登录"项存在 | STATIC（插件代码+app UI） |
| 会话查看/续接 | 工作区会话列表可见（"未命名会话"） | 待真机 | OWNER_VERIFIED（列表）/ NOT_TESTED（打开） |
| 审批 approve/deny | 待 Gate B | 待真机 | NOT_TESTED |
| remote-only（无手机引擎） | n/a | **受限**：扫码绑定强制 DeepSeek 登录→引擎前置；OAuth 直连路径是否可独立列出 Host 待真机 | OWNER_VERIFIED（前置条件） |
| Codex Remote 后端 | Host log `Codex Remote domain ready` | 同 Host | ACTUAL_RUN（Host 侧） |
| Devin 后端 | UNSUPPORTED_UPSTREAM | UNSUPPORTED_UPSTREAM | STATIC |
| Claude ACP 后端 | Host 侧 ready；模型 Provider 403 | 同 | BLOCKED_PROVIDER |

## 能力差异结论（实测）

- dsh-Go 的"扫码配对电脑"是**设备直接配对**路径（pairingRestricted/
  inboundOnly 语义），与账号设备列表是不同授权模型；且被 DeepSeek+
  本地引擎前置卡住。
- 手机若要 remote-only 用账号连接，应走 OAuth 登录后"选择工作电脑"
  列表——Host 已在账号下授权上线，理论上列表可见。**待 A01 真机确认**。
