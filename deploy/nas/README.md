# PROXY_HOST

代理配置见 [项目说明](../../README.md#proxy_host)。

## 网页一键升级 Docker 镜像

设置 → 版本信息 → Docker 一键升级 → 一键升级。确认后，临时 Watchtower 自动拉取当前镜像标签（例如 `sunqz/tg-vault:latest`），保留容器配置并重建当前容器。无需常驻更新服务，不会定时自动升级，也不会升级其他容器。

使用本目录的 Compose 模板时，运行：

```sh
docker compose -f compose.yaml -f compose.update.yaml up -d
```

已有自己的 Compose 文件时，在 `tg-vault` 服务下合并以下两项，保留原来的环境变量与卷挂载：

```yaml
environment:
  DOCKER_UPDATE_ENABLED: "true"
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

首次启用需要手动拉取包含此功能的新镜像，并重新创建容器；普通 `docker restart` 不会应用新增挂载。后续可直接在网页升级。`UPDATE_CHECK_ENABLED` 是 GitHub 版本提示的独立开关，设为 `false` 不影响这里的一键升级。

要求 Linux Docker、默认容器 hostname（不要自定义 `hostname`）、标准 Docker socket 和可写的持久化 `/data` 挂载。支持自定义 `container_name`，自动识别当前容器。使用可更新的标签；固定 digest、Swarm 服务或禁用 Watchtower 更新的标签不支持。镜像拉取使用 Docker 守护进程的网络配置；应用内的 Telegram 代理不等同于 Docker 镜像代理。私有仓库凭据暂不支持。

Docker socket 授予应用控制宿主机 Docker 的权限，请仅向可信管理员开放网页。升级接口要求登录和明确确认。升级会重启服务，可能中断上传、下载，请先等待任务完成。建议定期备份 `/data`。

启用升级时，启动脚本自动读取 socket 的用户组编号，以该组启动 `node` 用户的应用进程，适配 NAS 上常见的 `root:docker` 或 `root:root`、`0660` 权限。无需额外配置用户组，也不会修改宿主机 socket 权限。`docker exec -u node` 是独立进程，可能仍提示 `EACCES`，应以网页升级状态或实际应用进程的组编号判断。若 socket 仅允许所有者访问（如 `0600`），仍需管理员调整 Docker 服务的 socket 用户组权限。

升级记录存放在 `/data/docker-update.json`，重启后继续核验结果。只有 Watchtower 报告成功、镜像发生变化且容器健康检查通过后才显示升级成功。无新镜像时显示“当前镜像没有更新”。临时容器保留至结果核验后自动删除，最后一次任务日志保存至 `/data/docker-update.log`，旧镜像保留供管理员排查。若新镜像无法启动，网页无法自行恢复，请通过 NAS Docker 管理界面检查容器与 `tg-vault-update-*` 日志并手动恢复；不提供数据库自动回滚。

实现参考 outlookEmail 的按需启动 Watchtower 方案，使用固定版本 `containrrr/watchtower:1.7.1`，并从 Docker 守护进程读取 API 版本以避免旧默认版本不兼容。该上游已经归档，未来 Docker 版本升级后应重新验证兼容性。
