# 存储配置

本说明适用于 [traceonx/tg_value](https://github.com/traceonx/tg_value) 改进版。

## NAS 本地存储

在 Docker Compose 中将 NAS 下载目录挂载到 `/data/uploads`，并设置 `UPLOAD_DIR=/data/uploads`。网页路径填写容器内路径，不填写 NAS 的宿主机路径。

例如：

```yaml
environment:
  UPLOAD_DIR: "/data/uploads"
volumes:
  - ./data:/data
  - /你的NAS下载目录:/data/uploads
```

`/data` 用于持久保存数据库和应用配置，下载目录用于保存文件。修改挂载后需要重新创建容器。

## 其他存储源

进入网页「设置 → 存储」，选择存储类型并填写该存储源要求的连接信息。项目支持本地磁盘、OneDrive、Google Drive、阿里云 OSS、S3、WebDAV 和 OpenList。

添加账号后先测试连接，再将可用账号设为需要使用的存储目标。Telegram 可使用默认存储、聊天专属目标或本次任务指定的保存目录，具体保存位置以任务设置为准。

## 常见问题

- 本地目录无法写入：检查挂载目录是否可写，以及目录对容器内 `node` 用户的权限。
- 文件出现在不同目录：检查聊天专属保存目标和本次任务的目录设置。
- 修改挂载后未生效：在原 Compose 所在目录运行 `docker compose up -d`，应用新配置。
- 云存储连接失败：检查地址、凭据及网络代理配置，使用网页中的连接测试查看结果。
