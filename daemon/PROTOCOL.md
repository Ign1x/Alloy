# ElegantMC Panel <-> Daemon 协议（v0.1）

## WebSocket 连接

Daemon 主动连接 Panel 的 WebSocket：

- URL：`ELEGANTMC_PANEL_WS_URL`
- Header：
  - `Authorization: Bearer <token>`（`ELEGANTMC_TOKEN`）
  - `X-ElegantMC-Daemon: <daemon_id>`

## 通用 Envelope

所有消息使用统一 Envelope：

```json
{
  "type": "hello|heartbeat|command|command_result|log",
  "id": "optional-correlation-id",
  "ts_unix": 1730000000,
  "payload": {}
}
```

`command` / `command_result` 的 `id` 用于关联请求与响应。

## Daemon -> Panel

### `hello`

```json
{
  "type": "hello",
  "payload": {
    "daemon_id": "my-node",
    "version": "0.1.0",
    "os": "linux",
    "arch": "amd64",
    "features": ["fs", "mc", "frp"]
  }
}
```

### `heartbeat`

```json
{
  "type": "heartbeat",
  "payload": {
    "daemon_id": "my-node",
    "uptime_sec": 123,
    "last_error": "",
    "server_time_unix": 1730000000,
    "frp": {
      "running": true,
      "proxy_name": "mc",
      "remote_addr": "frp.example.com",
      "remote_port": 25566,
      "started_unix": 1730000000
    },
    "frp_proxies": [
      {
        "running": true,
        "proxy_name": "server1",
        "remote_addr": "frp.example.com",
        "remote_port": 25566,
        "started_unix": 1730000000
      }
    ],
    "cpu": {"usage_percent": 12.3},
    "mem": {"total_bytes": 17179869184, "used_bytes": 4294967296, "free_bytes": 12884901888},
    "disk": {"path": "/data", "total_bytes": 107374182400, "used_bytes": 123456789, "free_bytes": 107250725611},
    "net": {"hostname": "my-host", "ipv4": ["192.168.1.10"], "preferred_connect_addrs": ["192.168.1.10", "mc.example.com"]},
    "instances": [
      {"id": "server1", "running": true, "pid": 12345, "last_exit_code": 0, "last_exit_unix": 1730000000}
    ]
  }
}
```

### `command_result`

```json
{
  "type": "command_result",
  "id": "cmd-001",
  "payload": {
    "ok": true,
    "output": {"k": "v"},
    "error": ""
  }
}
```

### `log`

用于推送 `mc` / `frp` 的 stdout/stderr 行：

```json
{
  "type": "log",
  "payload": {
    "source": "mc|frp|install",
    "stream": "stdout|stderr",
    "instance": "server1",
    "line": "...."
  }
}
```

## Panel -> Daemon

### `command`

```json
{
  "type": "command",
  "id": "cmd-001",
  "payload": {
    "name": "mc_start",
    "args": {
      "instance_id": "server1",
      "jar_path": "server.jar",
      "xmx": "2G",
      "xms": "1G"
    }
  }
}
```

## 支持的命令（当前）

> 约束：`instance_id` 目前仅允许 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`（防止路径注入）。

### `ping`

返回 `{"pong": true}`。

### `mc_templates`

返回内置的服务端模板列表（含预设参数；Fabric 目前为占位符）：

- output: `{ "templates": [ ... ] }`

### `schedule_get`

读取 Scheduler 的 `schedule.json`（默认 `base_dir/schedule.json`）：

- output: `{ "path": "...", "exists": true|false, "schedule": { "tasks": [ ... ] } }`

### `schedule_set`

写入 Scheduler 的 `schedule.json`：

- args: `{ "json": "<raw json text>" }`
- 校验：
  - 最多 200 个 tasks
  - `type` 支持：`restart` / `stop` / `backup` / `announce` / `prune_logs`
  - `announce` 需要 `message`（单行，最多 400 字符）
  - `prune_logs` 需要 `keep_last >= 1`

常用字段（`tasks[]`）：

- `id`: string（必填，唯一）
- `enabled`: bool（可选，false 表示禁用）
- `type`: string（必填）
- `instance_id`: string（必填）
- `every_sec`: int（可选；周期任务）
- `at_unix`: int（可选；一次性任务）
- `keep_last`: int（可选；`backup` 的备份保留 / `prune_logs` 的日志保留）
- `stop`: bool（可选；`backup` 是否备份前停止，默认 true）
- `message`: string（可选；`announce` 的消息内容）

### `schedule_run_task`

立即运行一个任务（不等待下一次 tick）：

- args: `{ "task_id": "backup-server1" }`
- output: `{ "task_id": "...", "ran": true, "error": "" }`

### `diagnostics_bundle`

生成诊断包 zip（默认写入 `servers/_diagnostics/`），用于收集排障信息（已对敏感环境变量做脱敏）：

- args（可选）:
  - `instance_id`: string（只收集某一个实例的配置/日志）
  - `max_log_bytes`: int（每个 `latest.log` 最多保留尾部字节数，默认 200KB，最大 5MB）
  - `zip_path`: string（自定义 zip 相对路径，需在 `servers/` 下且以 `.zip` 结尾）
- output: `{ "zip_path": "_diagnostics/diagnostics-<daemon>-<ts>.zip", "files": 123, "created_at_unix": 1730000000 }`

### `mc_backup`

将 `servers/<instance_id>/` 目录打包为 zip（写入 `servers/_backups/<instance_id>/`）：

- args:
  - `instance_id`: 必填
  - `backup_name`: 可选（默认 `<instance>-<ts>.zip`）
  - `stop`: 可选（默认 true；备份前 best-effort stop）
- output: `{ "instance_id": "...", "path": "_backups/<instance>/<name>.zip", "files": 123 }`

### `mc_restore`

用 zip 覆盖恢复 `servers/<instance_id>/`：

- args:
  - `instance_id`: 必填
  - `zip_path`: 必填（相对 `servers/` 根，如 `_backups/<instance>/<name>.zip`）
- output: `{ "instance_id": "...", "restored": true, "files": 123 }`

### `fs_read`

读取 `servers` 根目录下文件（Base64）：

- args: `{ "path": "server1/server.properties" }`

### `fs_write`

写入 `servers` 根目录下文件（Base64）：

- args: `{ "path": "server1/server.properties", "b64": "..." }`

### `fs_upload_begin`

为大文件/二进制文件（mods/plugins/jar 等）开启一个分片上传会话：

- args: `{ "path": "server1/plugins/SomePlugin.jar" }`
- output: `{ "upload_id": "...", "path": "server1/plugins/SomePlugin.jar" }`

### `fs_upload_chunk`

上传一个分片（Base64）。Daemon 侧限制：单分片解码后最大 512KB；单文件最大 512MB。

- args: `{ "upload_id": "...", "b64": "..." }`
- output: `{ "upload_id": "...", "bytes": 123456 }`（累计已写入字节数）

### `fs_upload_commit`

提交上传并原子替换目标文件（写入 `.partial` 后 `rename`）：

- args: `{ "upload_id": "...", "sha256": "optional" }`
- output: `{ "path": "server1/plugins/SomePlugin.jar", "bytes": 123456, "sha256": "..." }`

### `fs_upload_abort`

中止上传并清理临时文件：

- args: `{ "upload_id": "..." }`

### `fs_list`

列目录：

- args: `{ "path": "server1" }`

### `fs_hash`

计算文件 SHA256（仅限 `servers/` 沙箱内）：

- args:
  - `path`: 目标文件路径（相对 `servers/` 根）
  - `max_bytes`: 可选。最大读取字节数（默认 512MiB；硬上限 2GiB）
- output: `{ "path": "...", "bytes": 123, "sha256": "...", "max_bytes": 536870912 }`

### `fs_search`

在 `servers/` 沙箱内查找文件（glob + 可选内容搜索）：

- args:
  - `path`: 搜索根目录（相对 `servers/`；空 = `servers/` 根）
  - `pattern`: glob（默认 `**/*`；支持 `*`、`?`、`[]`、`**`）
  - `query`: 内容查询（可选；空则只返回匹配到的文件列表）
  - `regex`: 可选（true 则把 `query` 当作正则）
  - `case_sensitive`: 可选（默认 false）
  - `recursive`: 可选（默认 true）
  - `include_binary`: 可选（默认 false；false 时会跳过常见二进制扩展名，并做 NULL byte 检测）
  - `max_files`: 可选（默认 60，最大 1000）
  - `max_matches`: 可选（默认 200，最大 5000）
  - `context_before` / `context_after`: 可选（0-20）
  - `max_bytes_per_file`: 可选（默认 2MiB，最大 20MiB）
  - `max_bytes_total`: 可选（默认 8MiB，最大 200MiB）
- output:
  - `files`: 匹配到的文件列表（含 size/mtime/matches/skipped_binary/truncated 等）
  - `matches`: 内容匹配结果（含 path/line_no/text/before/after）
  - `bytes_scanned`: 实际扫描字节数
  - `entries_visited`: 遍历到的条目数
  - `truncated`: 是否因限额/取消而提前结束

### `fs_zip`

将目录或「多选条目」打包为 zip（输出到 `servers/_exports/` 下或自定义 `zip_path`）：

- 目录模式 args:
  - `path`: 必填（相对 `servers/` 根；必须是目录）
  - `zip_path`: 可选（自定义 zip 相对路径；需在 `servers/` 下）
- 多选模式 args:
  - `base_dir`: 可选（路径基准目录，相对 `servers/` 根；默认 `.`）
  - `paths`: 必填（相对 `base_dir` 的路径数组；可包含文件/目录）
  - `zip_path`: 可选（自定义 zip 相对路径；需在 `servers/` 下）
- output:
  - 目录模式：`{ "path": "...", "zip_path": "_exports/<name>-<ts>.zip", "files": 123 }`
  - 多选模式：`{ "base_dir": "...", "paths": ["..."], "zip_path": "_exports/<name>-<ts>.zip", "files": 123 }`

安全限制：拒绝对 `servers/` 根目录本身打包；拒绝 symlink；拒绝任何逃逸沙箱的路径。

### `fs_zip_list`

列出 zip 文件内容（用于预览解压目标）：

- args:
  - `zip_path`: 必填（相对 `servers/` 根）
  - `strip_top_level`: 可选（默认 true；若 zip 内只有一个顶级目录则去掉该前缀）
- output: `{ "entries": [...], "files": 12, "total_bytes": 1234, "top_level_dir": "...", "strip_prefix": "..." }`

### `fs_unzip`

解压 zip 到目标目录（拒绝 symlink 与路径逃逸；支持可选去掉单一顶级目录前缀）：

- args:
  - `zip_path`: 必填（相对 `servers/` 根）
  - `dest_dir`: 必填（相对 `servers/` 根；不得为 `servers/` 根）
  - `strip_top_level`: 可选（默认 true）
  - `instance_id`: 可选（用于日志归属；默认等于 `dest_dir`）
- output: `{ "zip_path": "...", "dest_dir": "...", "files": 123, "dirs": 45, "strip_prefix": "..." }`

### `fs_delete`

删除文件/目录（递归），路径必须在 `servers` 根目录下：

- args: `{ "path": "server1/plugins/SomePlugin.jar" }`
- output: `{ "path": "...", "deleted": true, "is_dir": false }`

### `fs_download`

下载文件到 `servers` 根目录下（用于安装 server.jar / plugins / mods 等）：

- args:
  - `path`: 目标路径（如 `server1/server.jar`）
  - `url`: http/https 下载地址
  - `sha256`: 可选，校验用
  - `sha1`: 可选，校验用

### `mc_start`

启动 MC 实例（当前为本机进程模式）：

- args:
  - `instance_id`: `server1`
  - `jar_path`: `server.jar`（相对 `servers/<instance_id>/`）
  - `java_path`: 可选。指定要使用的 `java` 可执行路径/命令名；不填则 Daemon 自动从 jar 推断最低 Java 并在候选列表中选择
  - `xms` / `xmx`: 例如 `1G` / `2G`

### `mc_stop`

- args: `{ "instance_id": "server1" }`

### `mc_restart`

重启（等价于 `mc_stop` 后 `mc_start`，参数同 `mc_start`）：

- args: 同 `mc_start`

### `mc_console`

向实例 stdin 写入一行（例如 `say hi`）：

- args: `{ "instance_id": "server1", "line": "say hi" }`

### `mc_delete`

删除一个实例目录（`servers/<instance_id>`）。Daemon 会先 best-effort 停止进程，再执行删除：

- args: `{ "instance_id": "server1" }`

### `frp_start`

启动 `frpc`（Daemon 托管进程）：

- args:
  - `instance_id`: 可选。用于 per-instance FRP（建议传 instance_id；会作为 proxy 名称）
  - `name`: `mc`
  - `server_addr`: `frp.example.com`
  - `server_port`: `7000`
  - `token`: `...`（可选）
  - `local_ip`: `127.0.0.1`（可选）
  - `local_port`: `25565`
  - `remote_port`: `25566`（0 表示不写入该项，由 frp 服务端策略决定）

### `frp_stop`

停止 `frpc`。

- args:
  - `instance_id` / `name`: 可选。传入则只停止该 proxy；不传则停止全部 proxies。

### `frpc_install`

下载/更新 `frpc` 二进制到 Daemon 配置的固定路径（`ELEGANTMC_FRPC_PATH`）。该命令不允许自定义目标路径。

- args:
  - `url`: http/https 下载地址
  - `sha256`: 可选，校验用

## 安装类命令（当前）

### `mc_install_vanilla`

根据 Mojang 版本清单解析并下载 Vanilla 服务端 jar：

- args:
  - `instance_id`: `server1`
  - `version`: 例如 `1.20.1`
  - `jar_name`: 可选（默认 `server.jar`）
  - `accept_eula`: 可选（true 则写入 `eula.txt`）

返回：
- `jar_path`: `server.jar`（相对 `servers/<instance_id>/`）
- `path`: `server1/server.jar`（相对 `servers/` 根）

### `mc_install_paper`

通过 Paper API 下载 Paper 服务端 jar（默认最新 build）：

- args:
  - `instance_id`: `server1`
  - `version`: 例如 `1.20.1`
  - `build`: 可选（0 或不填表示最新）
  - `jar_name`: 可选（默认 `server.jar`）
  - `accept_eula`: 可选（true 则写入 `eula.txt`）
