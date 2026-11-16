# 安全说明（Gate 2）

## 攻击面控制

- Host 仅监听 `127.0.0.1:3080`；remote terminal `enabled:false`；Host
  shell/文件写未开放。
- Remote 传输经 dsh.r2049.cn 中继；端到端加密由协议负责——此处只记录
  配置事实，不声称协议级安全审计。
- 测试仓库限定 `~/agent-hub-poc` 合成 fixture；不触碰真实敏感目录。

## 凭据处理

- 注册码/launch token/cookie/设备私钥/会话正文均不入档、不推送。
- launch token 为进程内存随机值；本次重启 Host 的唯一目的就是捕获它
  （正规重启，非凭据伪造）。
- `server-credentials.json` 由插件正规流程生成（register-with-code），
  非手写 token、非复用其他产品 cookie。

## 遗留观察（如实）

- 本地控制面 `/ds-harness-remote/*` 依赖 launch token + Host/Origin
  fence；token 泄露=本机控制面被控——token 已按一次性处理。
- `host.registration-code.submit` 无速率/试错记录观察（本次一次成功）。
