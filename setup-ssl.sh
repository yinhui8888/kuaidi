#!/bin/bash
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
if [ -z "$1" ]; then echo -e "${RED}用法: ./setup-ssl.sh <你的域名> [你的邮箱]${NC}"; exit 1; fi
DOMAIN=$1; EMAIL=${2:-"admin@$DOMAIN"}
echo -e "${YELLOW}🚀 开始为 $DOMAIN 配置 Nginx 反向代理和 SSL 证书...${NC}"
if [ ! -f "docker-compose.yml" ]; then echo -e "${RED}❌ 找不到 docker-compose.yml！${NC}"; exit 1; fi
APP_PORT=$(grep -A 10 "app:" docker-compose.yml | grep -E "^\s+-\s+[\"']?[0-9]+:[0-9]+" | head -n 1 | awk -F: '{print $2}' | tr -d '\" ' || echo "80")
[ -z "$APP_PORT" ] && APP_PORT=80
mkdir -p nginx/conf.d certbot/conf certbot/www
cat > nginx/conf.d/app.conf <<EOF
server {
    listen 80; server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://app:${APP_PORT}; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; }
}
EOF
cat > docker-compose.override.yml <<EOF
version: '3.8'
services:
  app: { ports: !reset [] }
  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    restart: always
    depends_on: [app]
  certbot:
    image: certbot/certbot
    container_name: certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait \$\${!}; done;'"
EOF
echo -e "${YELLOW}→ 启动 Nginx 并通过 HTTP 验证域名...${NC}"
docker compose up -d nginx
sleep 3
echo -e "${YELLOW}→ 正在向 Let's Encrypt 申请 SSL 证书...${NC}"
docker compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email
echo -e "${YELLOW}→ 配置 HTTPS 并开启强制跳转...${NC}"
cat > nginx/conf.d/app.conf <<EOF
server {
    listen 80; server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl; server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    location / {
        proxy_pass http://app:${APP_PORT};
        proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
echo -e "${YELLOW}→ 重启 Nginx 并启动自动续期服务...${NC}"
docker compose up -d nginx certbot
echo -e "${GREEN}✅ 全部搞定！现在可以通过 https://$DOMAIN 访问了。${NC}"
