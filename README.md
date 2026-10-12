<p align="center">
  <img src="frontend/public/logo-80.webp" width="80" height="80" alt="TG Vault Logo">
</p>

<h1 align="center">TG Vault</h1>

<p align="center">
  <strong>Telegram 文件转存与频道下载工具</strong><br>
  链接下载 · 频道订阅 · NAS 存储 · Bot 与网页管理
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-blue" alt="React + TypeScript">
  <img src="https://img.shields.io/badge/backend-Node.js%20%2B%20PostgreSQL-336791" alt="Node.js + PostgreSQL">
</p>

<p align="center">
  <a href="#功能概览">功能概览</a> ·
  <a href="#bot-使用入口">Bot 使用入口</a> ·
  <a href="#代理配置">代理配置</a>
</p>

## 项目简介

TG Vault 将 Telegram 中的文件保存到本地磁盘或配置的云存储，适合在 NAS 上归档视频、图片和文档。你可以给 Bot 发送文件或消息链接，也可以按日期、标签批量下载频道内容，并通过网页或 Bot 查看任务进度。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 文件转存 | 接收发送或转发给 Bot 的文件，保存到选定存储 |
| 链接下载 | 解析 Telegram 消息链接，支持指定本次下载的文件夹名 |
| 频道下载 | 按日期、标签下载频道文件，支持频道订阅与后台扫描 |
| 任务管理 | 查看进度、暂停、继续、取消及重试失败任务 |
| 存储管理 | 本地磁盘、OneDrive、Google Drive、阿里云 OSS、S3、WebDAV 和 OpenList |
| 保存位置 | 系统默认存储、聊天专属存储目标、一次性或长期保存目录 |
| 文件浏览 | 网页搜索、预览、收藏和文件操作；Bot 本地列表直接读取磁盘 |
| 账号管理 | 用户账号登录、多账号调度、权限与健康状态管理、限流冷却 |
| 界面与认证 | 中文、英文；网页管理员密码、Bot PIN 与 TOTP 双重验证 |

## 开始使用

1. 打开网页，首次使用时创建管理员密码。
2. 在设置中配置 Telegram Bot，并设置自己的 **4 位数字 PIN**，项目没有默认 PIN。
3. 选择本地或云存储。在 Bot 中发送 `/start` 并完成身份验证。
4. 要下载频道内容，先在网页绑定并启用 Telegram 用户账号，确保该账号可以访问目标频道。

直接发送文件给 Bot 与读取频道是两种操作。频道下载依赖用户账号下载器；私有频道需要该账号已有访问权限，项目不会自动替你加入频道。

## Bot 使用入口

主菜单保留 7 个入口，具体操作通过按钮完成。旧指令继续兼容。

| 指令 | 用途 |
| --- | --- |
| `/start` | 身份验证与首页 |
| `/download` | 链接下载、日期或标签下载 |
| `/files` | 浏览文件、搜索与操作 |
| `/tasks` | 查看任务，选择任务后暂停、继续、取消或重试 |
| `/subscriptions` | 管理频道订阅 |
| `/settings` | 存储、保存目录、并发、去重、通知和安全设置 |
| `/help` | 查看使用入口 |

### 下载消息中的文件

向已认证的 Bot 发送链接，可在后面加上本次使用的文件夹名：

```text
https://t.me/channelname/123
https://t.me/channelname/123 我的收藏
```

指定名称时创建对应子文件夹；省略名称时按上海时区当天日期分类。消息链接下载只处理该消息，不扫描整个频道。日期范围和标签批量下载请使用 `/download` 中的向导。

### 设置保存目录

- `/p 视频`：设置下一次下载的保存目录。
- `/ps 视频`：设置当前聊天长期使用的目录，重启后保留。
- `/pc`：清除自定义目录设置。

目录相对于当前存储根目录。链接下载的文件夹名或日期分类会继续放在设置的目录下。单容器镜像的默认本地根目录为 `/data/uploads`，NAS 上的实际位置由该路径的挂载决定。

### 浏览本地文件

`/files` 中的浏览入口使用 `/list`，直接读取本地下载目录及子目录：手动放入的文件可以显示，手动删除的文件不再显示。列表按修改时间排序，支持 `/list 10 2` 查看第二页，并跳过隐藏文件、常见临时文件和预览等工作目录。

**网页文件列表与 Bot 搜索、文件操作仍依赖数据库记录。** 手动放入的视频不会因浏览而自动登记。目录扫描只读取文件；“清空本地存储”是独立的删除操作，可能包含手动放入的文件，执行前请确认范围。

## 代理配置

单容器镜像使用 `PROXY_HOST` 设置代理地址，格式为 `主机:端口`：

```yaml
environment:
  PROXY_HOST: "192.168.5.199:7890"
```

填写容器能够访问的代理地址，使用同时支持 HTTP 和 SOCKS5 的端口，例如 Clash/Mihomo 的 mixed 端口。入口脚本会据此配置 Telegram Bot、用户账号连接和 HTTP/HTTPS 请求的代理。

不需要代理时留空或不设置。代理运行在其他设备上时，该设备需允许局域网连接；不要填写容器自身的 `127.0.0.1`。

## 技术栈与项目结构

| 层级 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite、Tailwind CSS |
| 后端 | Node.js、TypeScript、Express |
| Telegram | GramJS / MTProto |
| 数据与媒体 | PostgreSQL、FFmpeg、Sharp |

```text
backend/src/           后端接口、Telegram 服务、存储与任务逻辑
frontend/src/          网页界面与交互
deploy/                容器运行脚本与配置
docs/                  专题说明
Dockerfile             单容器镜像定义
```

## 许可证

本项目采用 [MIT License](LICENSE)。
