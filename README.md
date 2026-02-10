# Alloy

> 面向自托管游戏服务器的控制平面：`Web + Control + Agent`。

Alloy 提供统一面板来管理实例、节点与更新流程，适合单机和多节点场景。

---

## 架构

```text
Web (SolidJS)
   │
   ▼
alloy-control (Axum + rspc)
   │
   └─ /agent/ws (反向连接)
   ▼
alloy-agent (下载 / 启停 / 文件 / 日志 / 更新)
```

---

## 快速开始（镜像部署）

### 1) 环境要求

- Docker
- Docker Compose

### 2) 获取仓库

```bash
git clone https://github.com/Ign1x/Alloy.git
cd Alloy
```

### 3) 一键安装（自动生成 `.env` + compose）

Linux / macOS：

```bash
bash deploy/install.sh --mode release
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install.ps1 -Mode release
```

脚本会自动生成：

- `.env`（缺失变量自动补齐，含随机密钥）
- `deploy/docker-compose.generated.release.yml`

### 4) 启动（已由脚本执行）

如需手动启动：

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.release.yml up -d
```

### 5) 访问

- Panel: `http://127.0.0.1:10043`
- Control ping: `http://127.0.0.1:10043/rspc/control.ping?input=null`
- 首次默认登录（若 `.env` 中为空）：`admin / admin123456`

如需运行游戏实例，请在节点机器单独部署 `alloy-agent`，并在面板 `Nodes` 中接入。

---

## 更新

升级到最新镜像：

```bash
bash deploy/install.sh --mode release
```

指定版本：

```bash
ALLOY_IMAGE_TAG=v0.2.7 bash deploy/install.sh --mode release
```

---

## 数据目录

默认使用“绑定到当前目录的 Docker volume”持久化：

- `./alloy-postgres`

删除容器但保留数据：

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.release.yml down
```

删除容器和数据卷：

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.release.yml down
rm -rf alloy-postgres
```

如果要先创建目录（避免首次启动权限问题）：

```bash
mkdir -p alloy-postgres
```

---

## 目录

```text
crates/
  alloy-agent/
  alloy-control/
  alloy-db/
  alloy-migration/
  alloy-proto/
web/
deploy/
```

---

## 文档

- Deployment details: `deploy/README.md`
- Workflow: `WORKFLOW.md`
