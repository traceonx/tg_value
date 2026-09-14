# TG Vault

Telegram 文件转存与频道下载工具。

## PROXY_HOST

单容器镜像使用 `PROXY_HOST` 设置代理地址，格式为 `主机:端口`：

```yaml
environment:
  PROXY_HOST: "192.168.5.199:7890"
```

填写容器能够访问的代理地址，使用同时支持 HTTP 和 SOCKS5 的端口，例如 Clash/Mihomo 的 mixed 端口。入口脚本会据此配置 Telegram Bot、用户账号连接和 HTTP/HTTPS 请求的代理。

不需要代理时留空或不设置。代理运行在其他设备上时，该设备需允许局域网连接；不要填写容器自身的 `127.0.0.1`。
