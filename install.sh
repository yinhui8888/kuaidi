#!/bin/bash
set -e
echo "→ 正在拉取最新镜像..."
docker compose pull
echo "→ 正在重启容器..."
docker compose up -d
echo "→ 清理旧的无用镜像..."
docker image prune -f
echo "✅ 部署完成！当前运行状态："
docker compose ps
