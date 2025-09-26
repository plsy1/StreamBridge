# **StreamBridge**

**StreamBridge** 是一个基于 **Node.js + ffmpeg** 的按需 RTSP/IPTV 流代理服务，支持多客户端共享拉流，也支持带 query 参数的单独回放流。适合内网或云端部署，用于 IPTV/监控流按需转发和中转。

## **特性**

- **按需拉流**：客户端请求时才启动 ffmpeg 拉流，减少资源浪费。
- **多客户端共享**：相同 URL 的普通流多个客户端复用同一个 ffmpeg 进程。
- **单独回放流**：带 query 参数（如 ?tvdr=...）的 URL 每个客户端独立拉流。
- **访问日志**：记录客户端 IP、访问时间和请求的 RTSP 地址。
- **Docker 部署**：可打包成 Docker 镜像，云端快速部署。

## **使用示例**

### **启动服务**

```shell
# 本地运行
node stream-proxy.js

# Docker 运行
docker build -t streambridge .
docker run -d --name streambridge -p 10000:10000 -e PORT=10000 streambridge
```

### **客户端访问示例**

**普通 URL（可复用，多客户端共享）**

```
http://localhost:10000/catchup/112.245.125.38:1554/iptv/Tvod/iptv/001/001/ch12122514263996485740.rsc
```

**带 query URL（单独拉流，不复用）**

```
http://localhost:10000/catchup/112.245.125.38:1554/iptv/Tvod/iptv/001/001/ch12122514263996485740.rsc?tvdr=20250926012300GMT-20250926021300GMT
```

- 第一个客户端访问会启动 ffmpeg
- 后续客户端访问普通 URL 会复用 ffmpeg
- 带 query URL 的每个客户端独立 ffmpeg

### **日志**

- 日志文件：access.log（默认在项目根目录）
- 记录内容：客户端 IP、访问时间、请求的 RTSP 地址

示例日志：

```
[2025-09-26T02:30:00.000Z] ::1 requested rtsp://192.168.1.1:8888/...
```

### **环境变量**

| **变量** | **默认值** | **说明**             |
| -------- | ---------- | -------------------- |
| PORT     | 10000      | Node.js 服务监听端口 |

### **Docker 部署建议**

- 可以通过 Nginx 反代，将客户端访问统一到 80 端口：

```
server {
    listen 80;
    server_name yourdomain.com;

    location /catchup/ {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
```

- Docker 启动示例：

```
docker run -d --name streambridge -p 8848:8848 -e PORT=8848 streambridge
```

### **License**

MIT License. See [LICENSE](./LICENSE) for details.