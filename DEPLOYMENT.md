# 安笺投保信息采集与档案管理：部署教程

适用项目：`D:\project\anjian-intake`

技术栈：

- 前端：原生 HTML / CSS / JavaScript，无前端构建步骤
- 后端：Node.js 20.19+、Express
- 数据库：MongoDB
- 图片识别：DeepSeek `deepseek-flash` 多模态模型
- 影像存储：本地文件 + AES-256-GCM 加密
- 反向代理建议：Nginx
- 进程托管建议：systemd

---

## 一、先解决启动失败

你在 PowerShell 中这样启动：

```powershell
PS D:\project\anjian-intake\server> node index
```

报错：

```text
FILE_ENCRYPTION_KEY 必须是 64 位十六进制字符，请检查 .env
```

原因：

- `.env` 文件位于项目根目录 `D:\project\anjian-intake\.env`
- 在 `server` 目录运行 Node 时，默认只会从当前目录寻找 `.env`
- 因此读取不到 `FILE_ENCRYPTION_KEY`

这个问题已经修复：应用现在始终从项目根目录加载 `.env`，与启动时所在目录无关。

推荐启动方式：

```powershell
cd D:\project\anjian-intake
npm start
```

即使已经修复，也建议统一在项目根目录执行命令，因为 `npm run set-password` 等脚本同样需要在根目录运行。

启动成功后应看到：

```text
安笺信息采集运行于 http://localhost:8788
管理端入口 http://localhost:8788/admin
智能识别：DeepSeek deepseek-flash
```

如果出现 `EADDRINUSE`，说明 8788 端口已被占用。先在 PowerShell 中检查并结束旧进程：

```powershell
netstat -ano | findstr :8788
Stop-Process -Id <PID>
```

---

## 二、本地启动

### 1. 准备环境

- Node.js 20.19 或更高版本，建议 Node.js 24 LTS
- npm 10 或更高版本
- MongoDB 已安装并运行在 `127.0.0.1:27017`
- 可访问 `https://api.deepseek.com` 的网络

检查环境：

```powershell
node -v
npm -v
```

检查 MongoDB 是否在监听：

```powershell
Test-NetConnection 127.0.0.1 -Port 27017
```

### 2. 安装依赖

```powershell
cd D:\project\anjian-intake
npm ci
```

当前项目没有前端打包步骤，安装完成后可直接启动。

### 3. 配置 `.env`

在项目根目录创建或修改 `.env`。可以从 `.env.example` 复制：

```powershell
Copy-Item .env.example .env
```

关键配置示例：

```env
HOST=0.0.0.0
PORT=8788
TRUST_PROXY=0

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=anjian_intake

ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为至少 8 位的强密码

FILE_ENCRYPTION_KEY=请替换为64位十六进制密钥
SESSION_TTL_HOURS=12
MAX_EXPORT_ROWS=300

DEEPSEEK_API_KEY=请填写你的DeepSeek密钥
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_MS=45000
```

生成 `FILE_ENCRYPTION_KEY`：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

要求：

- 必须是 64 位十六进制字符
- 不要提交到 Git
- 必须长期保存和备份
- 一旦丢失，已加密的身份证照片将无法恢复

管理员账号说明：

- 管理员密码以 `.env` 中的 `ADMIN_PASSWORD` 为准
- 修改后重启服务，会自动同步管理员密码并注销该账号的全部旧会话
- 也可以执行以下命令生成随机强密码：

```powershell
npm run set-password
```

该命令会把新密码同时写入 `.env` 并更新数据库，同时注销全部旧会话。请立即保存输出的新密码。

### 4. 启动

```powershell
npm start
```

开发时可以使用自动重启：

```powershell
npm run dev
```

本地页面：

- 采集端：`http://localhost:8788`
- 管理端：`http://localhost:8788/admin`

首次启动会自动创建管理员和 MongoDB 索引。

### 5. 验证自动识别

1. 进入采集端
2. 勾选“云端识别授权”
3. 上传身份证正面和反面
4. 确认识别结果出现在第 2 步表单
5. 如果提示“智能识别尚未配置”，检查 `DEEPSEEK_API_KEY` 并重启服务

---

## 三、环境变量说明

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `HOST` | 否 | 监听地址。本地可用 `0.0.0.0`，生产放在 Nginx 后建议 `127.0.0.1` |
| `PORT` | 否 | 服务端口，默认 `8788` |
| `TRUST_PROXY` | 否 | 位于 Nginx 等反向代理后设为 `1`，否则登录 Cookie 和限流 IP 可能异常 |
| `MONGODB_URI` | 是 | MongoDB 地址 |
| `MONGODB_DB` | 否 | 数据库名，默认 `anjian_intake` |
| `ADMIN_USERNAME` | 是 | 首次启动创建的管理员账号 |
| `ADMIN_PASSWORD` | 是 | 管理员密码，至少 8 位；修改后重启即同步生效 |
| `FILE_ENCRYPTION_KEY` | 是 | 影像加密密钥，64 位十六进制字符 |
| `SESSION_TTL_HOURS` | 否 | 管理员登录有效期，默认 12 小时 |
| `MAX_EXPORT_ROWS` | 否 | Excel 单次导出上限，默认 300 |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 密钥，只放在服务端 |
| `DEEPSEEK_API_URL` | 否 | 默认 `https://api.deepseek.com/chat/completions` |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-flash` |
| `DEEPSEEK_TIMEOUT_MS` | 否 | 模型请求超时，默认 45000 毫秒 |
| `DATA_DIR` | 否 | 运行数据目录，默认项目下 `data` |

注意：

- 如果 `DEEPSEEK_API_KEY` 为空，页面仍可手动填写，但无法自动识别
- 证件图片仅在用户勾选云端识别授权后才会发送给 DeepSeek
- 每次识别会调用一次 DeepSeek，产生相应 token 费用
- 请根据实际业务确认 DeepSeek 服务的数据留存与处理条款，并同步修改页面隐私说明

---

## 四、Linux 生产部署（Ubuntu 示例）

生产环境建议使用 Linux + Nginx + HTTPS。以下路径以 `/opt/anjian-intake` 为例。

### 1. 基础准备

- 一台 Linux 云服务器
- 已解析到服务器公网 IP 的域名，例如 `intake.example.com`
- 开放 80、443 和 SSH 端口
- 服务器可出站访问 `api.deepseek.com:443`

设置时区，保证“今日新增”等日期统计符合中国时区：

```bash
sudo timedatectl set-timezone Asia/Shanghai
```

安装基础工具：

```bash
sudo apt update
sudo apt install -y curl git ufw nginx
```

### 2. 安装 Node.js

推荐 Node.js 24 LTS。使用 NodeSource 安装：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

`node -v` 必须不低于 `v20.19.0`。

### 3. 安装和加固 MongoDB

按照 MongoDB 官方文档为对应 Ubuntu 版本配置软件源并安装 `mongodb-org`。安装后：

```bash
sudo systemctl enable --now mongod
```

编辑 `/etc/mongod.conf`：

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1

security:
  authorization: enabled
```

重启 MongoDB：

```bash
sudo systemctl restart mongod
```

使用 `mongosh` 创建数据库用户。请替换为独立强密码，不要把 MongoDB 直接暴露到公网：

```javascript
// 以管理员身份进入 mongosh 后
use admin
db.createUser({
  user: "anjian_root",
  pwd: "替换为管理员强密码",
  roles: ["root"]
})
```

再使用管理员账号创建应用用户：

```javascript
use anjian_intake
db.createUser({
  user: "anjian_app",
  pwd: "替换为应用强密码",
  roles: [{ role: "readWrite", db: "anjian_intake" }]
})
```

生产 `MONGODB_URI` 示例：

```env
MONGODB_URI=mongodb://anjian_app:应用密码@127.0.0.1:27017/anjian_intake?authSource=anjian_intake
MONGODB_DB=anjian_intake
```

如果密码包含 `@`、`:`、`/` 等字符，需要先进行 URL 编码。

### 4. 上传项目

创建运行用户和目录：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin anjian
sudo mkdir -p /opt/anjian-intake
sudo chown -R anjian:anjian /opt/anjian-intake
```

将项目文件上传到 `/opt/anjian-intake`。不要上传以下几项：

- `node_modules/`
- `.env`
- `data/` 中的本地开发数据

安装依赖：

```bash
cd /opt/anjian-intake
sudo -u anjian -H npm ci --omit=dev
```

应用没有前端构建步骤，无需执行 `npm run build`。

### 5. 配置生产 `.env`

```bash
sudo -u anjian -H bash -c 'cp .env.example .env'
sudo -u anjian -H nano .env
```

生产推荐配置：

```env
HOST=127.0.0.1
PORT=8788
TRUST_PROXY=1

MONGODB_URI=mongodb://anjian_app:应用密码@127.0.0.1:27017/anjian_intake?authSource=anjian_intake
MONGODB_DB=anjian_intake

ADMIN_USERNAME=admin
ADMIN_PASSWORD=管理员强密码
SESSION_TTL_HOURS=12
MAX_EXPORT_ROWS=300

FILE_ENCRYPTION_KEY=64位十六进制密钥
DATA_DIR=./data

DEEPSEEK_API_KEY=你的DeepSeek密钥
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_MS=45000
```

保护密钥文件：

```bash
sudo chown anjian:anjian /opt/anjian-intake/.env
sudo chmod 600 /opt/anjian-intake/.env
sudo chown -R anjian:anjian /opt/anjian-intake/data
sudo chmod 700 /opt/anjian-intake/data
```

### 6. 首次启动并创建管理员

先在前台启动一次，检查配置：

```bash
cd /opt/anjian-intake
sudo -u anjian -H npm start
```

确认输出中出现：

```text
安笺信息采集运行于 http://localhost:8788
智能识别：DeepSeek deepseek-flash
```

上述密码来自 `.env` 的 `ADMIN_PASSWORD`。如果需要更换密码，可修改 `.env` 后重启服务，或执行：

```bash
cd /opt/anjian-intake
sudo -u anjian -H npm run set-password
```

脚本会把新密码同步写入 `.env`，并注销全部已有会话。

### 7. 使用 systemd 托管服务

确认 Node 路径：

```bash
which node
```

创建 `/etc/systemd/system/anjian.service`：

```ini
[Unit]
Description=Anjian Insurance Intake
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=anjian
Group=anjian
WorkingDirectory=/opt/anjian-intake
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/anjian-intake/server/index.js
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/anjian-intake/data

[Install]
WantedBy=multi-user.target
```

说明：

- 如果 `which node` 不是 `/usr/bin/node`，修改 `ExecStart`
- `ReadWritePaths` 保证服务只能写运行数据目录
- 不建议使用 PM2 cluster 多进程运行；当前限流器在单进程内存中

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now anjian
sudo systemctl status anjian
sudo journalctl -u anjian -f
```

### 8. 配置 Nginx 反向代理

先创建 HTTP 配置 `/etc/nginx/sites-available/anjian`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name intake.example.com;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/anjian /etc/nginx/sites-enabled/anjian
sudo nginx -t
sudo systemctl reload nginx
```

安装证书并启用 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d intake.example.com
```

完成后再检查 Nginx 最终配置：

```bash
sudo nginx -T
```

确认 HTTPS 的 server 块中仍然保留：

- `client_max_body_size 30m`
- `proxy_read_timeout 120s`
- `proxy_set_header X-Forwarded-Proto $scheme`

如果 Certbot 生成的配置没有这些参数，请补充到 443 的 `location /` 中。

启用防火墙：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

不要开放 8788 和 27017 到公网。

### 9. 访问和验证

- 采集端：`https://intake.example.com`
- 管理端：`https://intake.example.com/admin`

验证清单：

1. 页面能通过 HTTPS 打开
2. 管理端能正常登录
3. 勾选授权后上传合成测试证件，DeepSeek 返回字段
4. 提交测试资料成功
5. 管理端能搜索、查看和下载身份证照片
6. 能导出包含照片的 Excel
7. 手机端上传和提交正常
8. 无权限访问 `/api/admin/submissions` 返回 401
9. 测试完成后在管理端删除测试档案

---

## 五、安全与合规要求

本应用会处理身份证影像和身份证号码，属于高敏感个人信息。上线前必须完成以下事项：

1. 全站强制 HTTPS，禁止通过 HTTP 收集资料
2. 更换初始管理员密码，使用独立强密码
3. `.env` 权限设为 600，禁止提交到代码仓库
4. 单独备份 `FILE_ENCRYPTION_KEY`，不要和数据文件放在一起
5. MongoDB 开启认证，仅监听 `127.0.0.1`
6. 开启服务器磁盘加密，因为 MongoDB 中的姓名、手机号、身份证号字段为明文
7. 限制管理端访问来源，可通过 VPN、固定 IP 白名单或零信任网关
8. 为 DeepSeek 图片识别确认数据处理协议、留存期限和跨境合规要求
9. 在页面隐私说明中补充真实运营主体、联系方式、保存期限和投诉渠道
10. 制定资料保留和删除制度，定期清理不再需要的档案与备份
11. 不能把 `data/uploads` 目录作为静态目录对外暴露
12. 审计日志保存在 MongoDB 的 `audit_logs` 集合中，应限制数据库访问权限

DeepSeek API Key 只能保存在服务端 `.env` 中，不能写入前端代码、日志或浏览器存储。

---

## 六、备份与恢复

### 备份 MongoDB

```bash
set -a
. /opt/anjian-intake/.env
set +a
mkdir -p /var/backups/anjian
mongodump --uri="$MONGODB_URI" --out=/var/backups/anjian/db-$(date +%F)
```

### 备份加密影像

```bash
sudo tar -czf /var/backups/anjian/uploads-$(date +%F).tar.gz \
  -C /opt/anjian-intake data/uploads
```

备份要求：

- 数据库备份和影像备份必须同时保存
- `FILE_ENCRYPTION_KEY` 必须独立备份到密码管理器或密钥保管系统
- 加密影像离开密钥无法恢复
- 备份文件本身也应加密，并限制访问
- 定期做恢复演练

### 恢复

```bash
mongorestore --uri="$MONGODB_URI" /path/to/db-backup
sudo tar -xzf /path/to/uploads-backup.tar.gz -C /opt/anjian-intake
sudo chown -R anjian:anjian /opt/anjian-intake/data
sudo systemctl restart anjian
```

---

## 七、更新版本

```bash
sudo systemctl stop anjian
cd /opt/anjian-intake
sudo -u anjian -H git pull   # 如果使用 Git 部署
sudo -u anjian -H npm ci
sudo -u anjian -H npm test
sudo systemctl start anjian
sudo systemctl status anjian
```

更新前请先备份数据库、影像目录和 `.env`。

---

## 八、常见问题

### 1. 提示 `FILE_ENCRYPTION_KEY 必须是 64 位十六进制字符`

检查：

- `.env` 是否在项目根目录
- 是否从项目根目录执行 `npm start`
- `FILE_ENCRYPTION_KEY` 是否为 64 位十六进制字符
- `.env` 是否被编辑器添加了额外空格或引号

### 2. `EADDRINUSE`

```bash
sudo ss -lptn 'sport = :8788'
```

结束占用进程，或修改 `PORT`。

### 3. 无法连接 MongoDB

检查 MongoDB 服务、端口、用户名密码和 `authSource`。生产环境 MongoDB 只应监听内网或 `127.0.0.1`。

### 4. 页面能打开，但自动识别不可用

检查：

- `DEEPSEEK_API_KEY` 是否为空
- 服务器能否访问 `https://api.deepseek.com`
- `DEEPSEEK_API_URL` 和 `DEEPSEEK_MODEL` 是否正确
- 查看 `journalctl -u anjian -n 100`

### 5. 上传返回 413

增大 Nginx 的 `client_max_body_size`，同时保证 Node 侧限制仍为合理值。

### 6. 登录成功后立即掉线

确认：

- 使用 HTTPS 访问
- `.env` 中设置 `TRUST_PROXY=1`
- Nginx 传递 `X-Forwarded-Proto $scheme`
- 没有在多层代理间丢失该请求头

### 7. 忘记管理员密码

修改 `.env` 中的 `ADMIN_PASSWORD` 后重启服务，或执行：

```bash
sudo -u anjian -H npm run set-password
```

两种方式都会同步管理员密码并注销全部旧会话。

### 8. 日期统计与项目日期不一致

确认服务器时区为 `Asia/Shanghai`：

```bash
timedatectl
```

---

## 九、上线前检查表

- [ ] Node.js 版本不低于 20.19
- [ ] MongoDB 已启用认证并仅本地监听
- [ ] `.env` 权限为 600
- [ ] `FILE_ENCRYPTION_KEY` 已生成并单独备份
- [ ] 管理员初始密码已更换
- [ ] `TRUST_PROXY=1`
- [ ] HTTPS 已启用并自动续期
- [ ] Nginx 上传大小和超时已配置
- [ ] DeepSeek 密钥仅在服务端
- [ ] 隐私说明中的运营主体、联系方式与保存期限已替换
- [ ] 已完成一次真实端到端测试并删除测试档案
- [ ] 数据库与影像备份任务已建立
- [ ] 管理端访问已通过 VPN 或 IP 白名单加固
