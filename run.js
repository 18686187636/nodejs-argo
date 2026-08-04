#!/usr/bin/env node

const fs = require('fs');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

// ---------- 日志重定向（同时写入文件和控制台） ----------
const logFile = 'komari-agent.log';
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  const msg = args.join(' ') + '\n';
  logStream.write(msg);
  originalConsoleLog(msg);
};
console.error = (...args) => {
  const msg = args.join(' ') + '\n';
  logStream.write(msg);
  originalConsoleError(msg);
};

const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStdoutWrite(chunk, encoding, callback);
};
process.stderr.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStderrWrite(chunk, encoding, callback);
};

// ---------- 检查 agent 文件 ----------
function agentExists() {
  const agentPath = './agent';
  if (!fs.existsSync(agentPath)) {
    console.error(`❌ 错误: ${agentPath} 文件不存在`);
    return false;
  }
  return true;
}

async function validateAgentWithFile() {
  const agentPath = './agent';
  try {
    const { stdout } = await execPromise(`file ${agentPath}`);
    // 如果包含 "no program header" 或 "missing section headers"，视为无效
    if (stdout.includes('no program header') || stdout.includes('missing section headers')) {
      console.error(`❌ 错误: ${agentPath} 文件不完整 (${stdout.trim()})`);
      return false;
    }
    if (!stdout.includes('ELF')) {
      console.error(`❌ 错误: ${agentPath} 不是 ELF 可执行文件 (${stdout.trim()})`);
      return false;
    }
    console.log(`✅ file 命令验证通过: ${stdout.trim()}`);
    return true;
  } catch (e) {
    console.error(`❌ 执行 file 命令失败: ${e.message}`);
    return false;
  }
}

// ---------- 测试 agent 基本可用性 ----------
async function testAgentBasic() {
  try {
    await execPromise('./agent -h', { timeout: 2000 });
    console.log('✅ agent 测试命令运行成功 (-h)');
    return;
  } catch {
    try {
      await execPromise('./agent --version', { timeout: 2000 });
      console.log('✅ agent 测试命令运行成功 (--version)');
      return;
    } catch {
      console.warn('⚠️ 警告: agent 不支持 -h 或 --version，跳过测试');
    }
  }
}

// ---------- 检查 agent 进程是否存活 ----------
async function checkAgentAlive() {
  try {
    const { stdout } = await execPromise('pgrep -f "./agent"');
    const pids = stdout.trim().split('\n').filter(p => p);
    if (pids.length) {
      console.log(`✅ agent 进程已启动 (PID: ${pids.join(', ')})`);
      return true;
    }
  } catch {
    try {
      const { stdout } = await execPromise('ps aux');
      if (stdout.includes('./agent')) {
        console.log('✅ agent 进程可能已启动（通过 ps 检查）');
        return true;
      }
    } catch {}
  }
  console.warn('⚠️ 警告: 未检测到 agent 进程，可能启动后立即崩溃，请查看日志');
  return false;
}

// ---------- 主流程 ----------
async function main() {
  console.log('🚀 启动脚本开始...');

  // 1. 检查 agent 文件是否存在
  console.log('📦 正在检查 agent 文件...');
  if (!agentExists()) {
    console.error('❌ agent 文件缺失，退出');
    process.exit(1);
  }

  // 2. 赋予执行权限
  console.log('🔧 正在设置 agent 执行权限...');
  try {
    await execPromise('chmod +x ./agent');
    console.log('✅ 权限设置成功');
  } catch (e) {
    console.error(`❌ chmod 失败: ${e.message}`);
    process.exit(1);
  }

  // 3. 使用 file 命令验证（同时检查完整性）
  console.log('🔍 验证 agent 文件格式（使用 file 命令）...');
  if (!(await validateAgentWithFile())) {
    console.error('❌ agent 文件无效或不完整，请重新下载正确的二进制文件');
    process.exit(1);
  }

  // 4. 测试 agent
  console.log('🧪 正在测试 agent 基本可用性...');
  await testAgentBasic();

  // 5. 后台启动 agent
  console.log('⏳ 正在后台启动 agent ...');
  const agentCmd =
    'nohup ./agent -e https://komari.tian-ye.cc.cd -t uK8uzaEX8Jydu8Dw0SsOKT ' +
    '>> komari-agent.log 2>&1 &';
  try {
    exec(agentCmd, (error) => {
      if (error) {
        console.error(`❌ 启动 agent 失败: ${error.message}`);
        process.exit(1);
      }
    });
  } catch (e) {
    console.error(`❌ 启动 agent 失败: ${e.message}`);
    process.exit(1);
  }

  // 6. 等待并检查进程
  console.log('⏳ 等待 2 秒检查 agent 进程是否存活...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await checkAgentAlive();

  // 7. 运行真实应用 index.js
  console.log('▶️ 正在运行 node index.js ...');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('node', ['index.js'], { stdio: 'inherit' });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`index.js 退出码 ${code}`));
        } else {
          resolve();
        }
      });
      child.on('error', (err) => {
        reject(err);
      });
    });
    console.log('✅ 所有命令执行完毕，index.js 正常退出。');
  } catch (e) {
    console.error(`❌ index.js 运行失败: ${e.message}`);
    process.exit(1);
  }

  logStream.end();
}

main().catch(err => {
  console.error(`💥 未捕获的错误: ${err.message}`);
  process.exit(1);
});
