# waoowaoo Linux 环境部署要求

> 适用 waoowaoo 0.4.x。本文只说明 Linux 下需要安装的环境、版本、端口和启动进程，不包含 CI/CD、自动发布、数据库导入导出或产品操作。

## 1. 推荐服务器

- 系统：Ubuntu Server 22.04 LTS 或 24.04 LTS，64 位
- CPU：最低 4 核，推荐 8 核
- 内存：最低 8 GB，推荐 16 GB
- 磁盘：最低 80 GB SSD，推荐 200 GB 以上
- Swap：2–4 GB
- GPU：waoowaoo 本身不需要 GPU；只有在同机运行 ComfyUI 时才需要 NVIDIA GPU、驱动和 CUDA

## 2. 必需环境与版本

| 环境 | 建议版本 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| Node.js | 22 LTS；最低 18.18 | 必需 | 项目 `.nvmrc` 为 22.14.0 |
| npm | 10.x；最低 9 | 必需 | 使用 `package-lock.json` 和 `npm ci` |
| MySQL | 8.0.x | 必需 | Prisma 主数据库 |
| Redis | 7.x | 必需 | BullMQ 队列和任务状态 |
| MinIO | S3 兼容版本 | 推荐 | 保存图片、视频、音频；也可使用项目支持的其他存储模式 |
| FFmpeg | 6.x 或系统仓库稳定版 | 必需 | AI 剪辑/成片合并接口直接调用 `ffmpeg` 命令 |
| Git | 2.34+ | 推荐 | 拉取和更新代码 |
| Nginx/Caddy | 当前稳定版 | 生产必需 | HTTPS 和反向代理 |
| PM2 或 systemd | 当前稳定版 | 二选一 | 守护 Web、worker、watchdog 和 Bull Board |

项目依赖 `sharp`，执行 `npm ci` 时会安装对应 Linux 预编译包。不要直接把 Windows 下的 `node_modules` 复制到 Linux。

## 3. Ubuntu 安装基础软件

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential ffmpeg
```

建议使用 nvm 安装 Node.js 22：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
npm -v
ffmpeg -version
```

如果严格按仓库版本运行：

```bash
cd /opt/waoowaoo
nvm install
nvm use
```

## 4. MySQL 8.0

安装：

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
mysql --version
```

要求：

- MySQL 8.0
- 字符集使用 `utf8mb4`
- 数据库示例名称：`waoowaoo`
- 建议创建独立业务用户，不要让应用长期使用 root
- 数据库地址需要允许 waoowaoo 服务器访问

连接格式：

```dotenv
DATABASE_URL=mysql://用户名:URL编码后的密码@127.0.0.1:3306/waoowaoo
```

如果 MySQL 在另一台机器，将 `127.0.0.1` 改成数据库内网地址。密码包含 `@`、`#`、`:`、`/` 时必须 URL 编码。

## 5. Redis 7

Ubuntu 24.04 可直接安装系统版本；如系统仓库版本较旧，使用 Redis 官方软件源安装 7.x。

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-server --version
redis-cli ping
```

环境变量：

```dotenv
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=<生产环境建议设置密码>
REDIS_TLS=
```

Redis 不得暴露公网。远程 Redis 只允许通过内网、安全组或 VPN 访问。

## 6. 文件与对象存储

生产环境推荐 MinIO，不建议长期使用本地临时目录保存媒体文件。

环境变量：

```dotenv
STORAGE_TYPE=minio
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_REGION=us-east-1
MINIO_BUCKET=waoowaoo
MINIO_ACCESS_KEY=<Access Key>
MINIO_SECRET_KEY=<Secret Key>
MINIO_FORCE_PATH_STYLE=true
```

MinIO 可以安装在本机、其他内网服务器或通过 Docker 单独运行。需要创建 `waoowaoo` bucket，并确保应用用户拥有读写权限。

如果只做临时测试，可以使用：

```dotenv
STORAGE_TYPE=local
```

本地存储不适合多实例部署，服务器迁移时也更容易遗漏媒体文件。

## 7. ComfyUI 环境关系

ComfyUI 不是 waoowaoo 的必需环境；只有选择本地 ComfyUI 视频模型时才需要。

若 ComfyUI 地址为 `http://192.168.0.89:8188`，Linux 服务器必须能够访问：

```bash
curl --fail --max-time 10 http://192.168.0.89:8188/system_stats
curl --fail --max-time 10 http://192.168.0.89:8188/object_info >/dev/null
```

注意：

- ComfyUI 是由 waoowaoo 的 server/worker 调用，不是浏览器直接调用。
- 公有云服务器无法直接访问家庭局域网的 `192.168.x.x`。
- 跨网络建议使用 WireGuard、Tailscale/Headscale 或站点到站点 VPN。
- 不要将无认证的 8188/8189 直接开放到公网。

## 8. 项目环境变量

从模板复制：

```bash
cp .env.example .env
chmod 600 .env
```

必须配置：

```dotenv
# 数据库
DATABASE_URL=mysql://waoowaoo:<密码>@127.0.0.1:3306/waoowaoo

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=<密码>
REDIS_TLS=

# 存储
STORAGE_TYPE=minio
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_REGION=us-east-1
MINIO_BUCKET=waoowaoo
MINIO_ACCESS_KEY=<Access Key>
MINIO_SECRET_KEY=<Secret Key>
MINIO_FORCE_PATH_STYLE=true

# 站点地址
NEXTAUTH_URL=https://你的域名
INTERNAL_APP_URL=http://127.0.0.1:3000

# 安全密钥，全部使用不同的随机值
NEXTAUTH_SECRET=<随机值>
CRON_SECRET=<随机值>
INTERNAL_TASK_TOKEN=<随机值>
API_ENCRYPTION_KEY=<固定随机值，投入使用后不要随意更换>
```

生成随机值：

```bash
openssl rand -hex 32
```

可调配置：

```dotenv
WATCHDOG_INTERVAL_MS=30000
TASK_HEARTBEAT_TIMEOUT_MS=90000
QUEUE_CONCURRENCY_IMAGE=4
QUEUE_CONCURRENCY_VIDEO=2
QUEUE_CONCURRENCY_VOICE=4
QUEUE_CONCURRENCY_TEXT=8

BULL_BOARD_HOST=127.0.0.1
BULL_BOARD_PORT=3010
BULL_BOARD_BASE_PATH=/admin/queues
BULL_BOARD_USER=<运维账号>
BULL_BOARD_PASSWORD=<强密码>

LOG_UNIFIED_ENABLED=true
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_DEBUG_ENABLED=false
LOG_AUDIT_ENABLED=true
LOG_SERVICE=waoowaoo
LOG_REDACT_KEYS=password,token,apiKey,apikey,authorization,cookie,secret,access_token,refresh_token

BILLING_MODE=OFF
LLM_STREAM_EPHEMERAL_ENABLED=true
```

`API_ENCRYPTION_KEY` 用于保护已保存的模型 API 配置。更换它可能导致已有密钥无法解密。

## 9. 安装项目依赖

```bash
cd /opt/waoowaoo
npm ci
npx prisma generate
```

检查：

```bash
npm run typecheck
npm run build
```

数据库由你自行导入后，建议检查当前结构是否与 `prisma/schema.prisma` 一致。若确认需要由项目补齐结构，再执行：

```bash
npx prisma db push --skip-generate
```

生产数据库执行任何结构同步前都应先备份。

## 10. 必须运行的进程

生产环境需要同时运行以下四个进程：

```bash
npm run start:next
npm run start:worker
npm run start:watchdog
npm run start:board
```

项目提供统一启动命令：

```bash
npm run start
```

它会先初始化存储，然后通过 `concurrently` 同时启动上述进程。直接关闭 SSH 终端会导致进程退出，因此生产环境必须使用 systemd 或 PM2 守护。

推荐 PM2：

```bash
sudo npm install -g pm2
cd /opt/waoowaoo
pm2 start npm --name waoowaoo -- run start
pm2 save
pm2 startup
```

执行 `pm2 startup` 后，继续运行它输出的那条 sudo 命令。

检查：

```bash
pm2 status
pm2 logs waoowaoo
curl -I http://127.0.0.1:3000
```

## 11. Nginx 反向代理

安装：

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

站点配置示例：

```nginx
server {
    listen 80;
    server_name waoo.example.com;

    client_max_body_size 200m;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
    }

    location /admin/queues/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用 HTTPS 可使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d waoo.example.com
```

SSE 依赖长连接，因此 Nginx 不能对主应用开启响应缓冲，超时时间也不能太短。

## 12. 端口清单

| 端口 | 服务 | 建议暴露范围 |
| --- | --- | --- |
| 3000 | Next.js | 仅本机，由 Nginx 代理 |
| 3010 | Bull Board | 仅本机/运维内网，必须设置账号密码 |
| 3306 | MySQL | 仅本机或数据库内网 |
| 6379 | Redis | 仅本机或应用内网 |
| 9000 | MinIO API | 仅本机或应用内网 |
| 9001 | MinIO Console | 仅运维内网 |
| 80/443 | Nginx | 公网 |
| 8188/8189 | ComfyUI | 仅可信内网/VPN |

## 13. 环境验收

```bash
node -v
npm -v
mysql --version
redis-server --version
ffmpeg -version
curl -I http://127.0.0.1:3000
pm2 status
```

还需确认：

1. MySQL 数据库能连接。
2. Redis 返回 `PONG`。
3. MinIO bucket 能读写。
4. app 日志中各 worker 显示 `ready`。
5. 域名 HTTPS 正常。
6. 如果使用 ComfyUI，Linux 服务器能访问其 `/system_stats` 和 `/object_info`。
7. `waoowaoo_admin` 可以进入账号管理，普通账号不能进入。

