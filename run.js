#!/usr/bin/env node

const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// ========== 配置 ==========
const AGENT_URL = process.env.AGENT_URL;
const AGENT_TOKEN = process.env.AGENT_TOKEN;
if (!AGENT_URL || !AGENT_TOKEN) {
    console.error('❌ 必须通过环境变量设置 AGENT_URL 和 AGENT_TOKEN');
    process.exit(1);
}

const AGENT_BIN = './agent';
const LOG_FILE = 'komari-agent.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// ========== 平台检查 ==========
if (os.platform() !== 'linux') {
    console.error(`❌ 错误: agent 二进制文件仅支持 Linux 平台，当前系统为 ${os.platform()}`);
    process.exit(1);
}

// ========== 日志轮转 ==========
if (fs.existsSync(LOG_FILE)) {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
        const backup = `${LOG_FILE}.old`;
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(LOG_FILE, backup);
        console.log(`📦 日志已轮转: ${LOG_FILE} -> ${backup}`);
    }
}

// 创建日志写入流（追加模式）
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
// 重定向 console 到日志 + 控制台
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => {
    const msg = args.join(' ') + '\n';
    logStream.write(msg);
    originalLog(msg);
};
console.error = (...args) => {
    const msg = args.join(' ') + '\n';
    logStream.write(msg);
    originalError(msg);
};

// ========== 检查 agent 文件 ==========
if (!fs.existsSync(AGENT_BIN)) {
    console.error(`❌ 错误: ${AGENT_BIN} 文件不存在`);
    process.exit(1);
}
// 赋予执行权限
try {
    fs.chmodSync(AGENT_BIN, 0o755);
} catch (err) {
    console.error(`❌ 无法设置执行权限: ${err.message}`);
    process.exit(1);
}

// ========== 主流程（使用 async 函数） ==========
async function main() {
    // 启动 Agent
    console.log(`🚀 启动 Agent: ${AGENT_BIN} -e ${AGENT_URL} -t ${AGENT_TOKEN}`);
    const agent = spawn(AGENT_BIN, ['-e', AGENT_URL, '-t', AGENT_TOKEN], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    agent.stdout.on('data', (data) => {
        const msg = data.toString();
        logStream.write(msg);
        console.log(`[agent stdout] ${msg.trim()}`);
    });
    agent.stderr.on('data', (data) => {
        const msg = data.toString();
        logStream.write(msg);
        console.error(`[agent stderr] ${msg.trim()}`);
    });

    agent.on('error', (err) => {
        console.error(`❌ Agent 启动失败: ${err.message}`);
        process.exit(1);
    });
    agent.on('exit', (code, signal) => {
        console.log(`⚠️ Agent 进程退出，code=${code}, signal=${signal}`);
        process.exit(code || 1);
    });

    // 给 agent 一点初始化时间（非必须，但可避免过早启动主服务）
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 启动主服务 index.js
    console.log('▶️ 启动主服务 index.js ...');
    const app = spawn('node', ['index.js'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    app.stdout.on('data', (data) => {
        const msg = data.toString();
        logStream.write(msg);
        console.log(`[app stdout] ${msg.trim()}`);
    });
    app.stderr.on('data', (data) => {
        const msg = data.toString();
        logStream.write(msg);
        console.error(`[app stderr] ${msg.trim()}`);
    });

    app.on('error', (err) => {
        console.error(`❌ 主服务启动失败: ${err.message}`);
        agent.kill();
        process.exit(1);
    });
    app.on('exit', (code, signal) => {
        console.log(`🏁 主服务退出，code=${code}, signal=${signal}`);
        agent.kill();
        process.exit(code || 0);
    });

    // 捕获进程退出信号，清理资源
    process.on('SIGINT', () => {
        console.log('收到 SIGINT，正在停止...');
        agent.kill();
        app.kill();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('收到 SIGTERM，正在停止...');
        agent.kill();
        app.kill();
        process.exit(0);
    });
}

// 执行主函数
main().catch(err => {
    console.error(`💥 未捕获的错误: ${err.message}`);
    process.exit(1);
});
