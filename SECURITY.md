# SECURITY

本项目目标是「公网 Panel + 本地 Daemon」的远程管理，因此安全边界非常明确：**Panel 绝不能成为你机器的远程 shell**，Daemon 也不应被当成“通用执行器”。

## 威胁模型（简版）

- **公网 Panel 被扫描/爆破**：攻击者尝试获取管理员权限、读取 token、控制节点/服务器。
- **token 泄露**：攻击者伪装成你的 Daemon 连接 Panel，或伪装 Panel 下发命令。
- **沙箱逃逸/路径穿越**：通过文件管理/上传等能力访问 `servers/` 以外路径。
- **FRP/下载链路被投毒**：恶意二进制或 jar 被下载并执行。

## 当前防护点（v1.0）

- Panel 使用管理员密码登录（Cookie session），并带基础爆破限制与 session GC。
- Daemon 默认仅允许访问自身工作目录下的 `servers/`（路径解析拒绝逃逸）。
- Daemon 可绑定到首次连接的 Panel（`panel_id` 绑定），避免同一个 Daemon 被多个 Panel “认领”。
- Panel 对敏感 token 默认不明文下发（Nodes/FRP 列表只返回 masked；复制时走受控 endpoint）。
- `frpc_install` 强制要求 `sha256` 校验（下载后校验一致才落盘）。

## 部署建议（强烈建议）

1) **公网部署必须 HTTPS**
- 反向代理（Nginx/Caddy）启用 TLS，并正确转发 WebSocket（Upgrade）。
- 仅在 HTTPS 下开启 `ELEGANTMC_PANEL_SECURE_COOKIE=1`。
- 需要的话开启 `ELEGANTMC_PANEL_HSTS=1`（确认域名已稳定启用 HTTPS 后再开）。

2) **使用强密码**
- `ELEGANTMC_PANEL_ADMIN_PASSWORD` 设置为强随机字符串，不要复用常见密码。

3) **保护 token**
- 将 `daemon token` / `frp token` 当作密钥对待。
- 泄露或怀疑泄露：删除并重新创建（旋转 token），并重启相关 Daemon。

4) **最小化暴露面**
- 默认不要启用 `ELEGANTMC_ENABLE_ADVANCED`。
- 将 Panel 绑定在内网或通过 VPN/ACL 限制来源也是好选择。

5) **运行时隔离**
- Docker 部署建议使用独立 volume 持久化数据，避免映射宿主机敏感目录。
- Daemon 主机上不要给不必要的 sudo 权限；不要把本项目当作系统级运维工具。

## 漏洞反馈

请在 GitHub 仓库通过私密渠道提交安全问题（如有）。在公开修复前不要公开细节。

