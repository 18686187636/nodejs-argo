FROM node:alpine3.22

# 设置工作目录（避免 /tmp 被清理）
WORKDIR /app

# 复制所有必要文件
COPY index.js index.html package.json run.js ./
COPY agent ./agent

# 安装系统依赖和 Node 依赖
RUN apk update && apk upgrade && \
    apk add --no-cache openssl curl gcompat iproute2 coreutils bash && \
    chmod +x index.js run.js agent && \
    npm install

# 暴露端口
EXPOSE 3000/tcp

# 启动 run.js（它会先启动 agent，再运行 index.js）
CMD ["node", "run.js"]
