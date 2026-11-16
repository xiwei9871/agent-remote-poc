# Gate A — Host 账号授权与配对（ACTUAL_RUN，2026-11-16）

## 结论：`HOST_BOUND_WEB_VISIBLE` 达成

```
04:08:16  Host registration code authorized
04:08:19  server control connection online  {"serverVersion":"dotnet-experimental"}
04:08:44  server control connection online  （连续稳定）
status    online:True authorized:True error:None accountRequired:False
```

## 三条独立授权链（排查结论）

| 链 | 用途 | 本机状态 |
| --- | --- | --- |
| DSH 模型 Provider | 会话内 LLM 调用 | shenlan 网关已通（与 Remote 无关） |
| Devin CLI/ACP | Devin 会话 | 独立凭据（与 Remote 无关） |
| **ds-harness-remote 服务账号** | Host↔dsh.r2049.cn 控制面 | **本轮授权对象**——`host_registration_code` 完成 |

`ACCOUNT_AUTH_REQUIRED 401` 含义实测：Host 的设备身份(deviceId+密钥)在服务端未绑定任何账号，控制连接被拒（retryable:false）。与"登录"不同——需要的是**账号→设备绑定**。

## 授权路径对比（实测）

| 路径 | 结果 |
| --- | --- |
| `host.pairing.start` → `qrPayload` 链接 | 生成成功；但 `/pair` 网页只提示"用 DSH Go 扫电脑上的二维码"，网页端无完成按钮 → **无法独立完成** |
| dsh-Go「扫码配对电脑」 | **CLIENT_CAPABILITY_GAP**：按钮灰置，要求先在手机安装本地运行引擎并登录 DeepSeek 账号——与 remote-only 目标冲突 |
| `host.account.login`(email+password) | 存在但需账号密码；注册需邀请码，不适用 |
| **`host.registration-code.submit`**（一次性注册码） | **PASS**：Remote Web 设备页底部"Linux 服务"安装命令内嵌一次性码（示例形态 `XXXX-XXXX`，~7:40 有效），提交后立即 `authorized` |
| Remote Web「Authorize Host from Remote client」 | 页面未见待授权设备条目；授权入口实际就是注册码 |

操作明细：`POST /ds-harness-remote/host.registration-code.submit`
`{"code":"NZRT-****"}` → `{ok:true, value:{method:"host_registration_code"}}`
→ `host.reconnect` → server control connection online。

## 本机控制面发现（对后续调试有用）

- Web UI 本地 launch token 是**进程内存随机值**，仅在启动时打印
  `dsh web: http://127.0.0.1:3080/?token=...` 一次——`--no-open` 下需重启并
  捕获 stdout 才能拿到（已验证重启恢复授权无影响）。
- token mint 出 HttpOnly cookie（audience 绑定 `127.0.0.1:3080`，
  `localhost` 别名会 401）。
- loopback RPC：`/ds-harness-remote/<method>`，消息体
  `{type:"client-request",rpcId,method,payload}`。
- 配对会话 TTL ~4 分钟；`pairing.status` 对已消费/过期会话返回空。

## 未泄露项

注册码全文、launch token、cookie、设备私钥均未入档；host.log 本就不含
token 明文。
