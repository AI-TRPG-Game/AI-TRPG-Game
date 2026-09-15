const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.player-runtime');
fs.mkdirSync(runtime, { recursive: true });
const metadata = path.join(runtime, 'instance.json');
const log = path.join(runtime, 'launcher.log');
const origin = 'http://127.0.0.1:5173';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function health() {
  try { const r = await fetch(origin + '/launcher/health', { signal: AbortSignal.timeout(1000) }); return await r.json(); } catch { return null; }
}
function openBrowser() { spawn('explorer.exe', [origin], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); }
function newest(dir) {
  if (!fs.existsSync(dir)) return 0;
  const stat = fs.statSync(dir);
  return stat.isDirectory() ? Math.max(stat.mtimeMs, ...fs.readdirSync(dir).map(name => newest(path.join(dir, name)))) : stat.mtimeMs;
}
async function main() {
  if (process.argv.includes('--stop')) {
    const current = await health();
    if (!current) return;
    const saved = JSON.parse(fs.readFileSync(metadata, 'utf8'));
    if (current.app !== 'ai-trpg-player' || current.pid !== saved.pid) throw new Error('当前端口不属于本启动器，未关闭任何程序。');
    const response = await fetch(origin + '/launcher/shutdown', { method: 'POST', headers: { 'x-launcher-token': saved.token }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('游戏仍在处理请求，或实例已变更，请稍后通过页面退出。');
    return;
  }
  const current = await health();
  if (current?.app === 'ai-trpg-player') { openBrowser(); return; }
  const net = require('node:net');
  await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', () => reject(new Error('端口5173已被占用，请先关闭开发服务器或占用程序。'))); probe.listen(5173, '127.0.0.1', () => probe.close(resolve)); });
  if (!fs.existsSync(path.join(root, 'node_modules/vite/bin/vite.js')) || !fs.existsSync(path.join(root, 'backend/node_modules/express'))) throw new Error('缺少依赖，请在项目目录运行一次 npm install。');
  const output = path.join(root, 'dist/index.html');
  const inputs = ['src', 'index.html', 'vite.config.mjs', 'package.json', 'package-lock.json'];
  if (!fs.existsSync(output) || inputs.some(input => newest(path.join(root, input)) > fs.statSync(output).mtimeMs)) {
    const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    fs.appendFileSync(log, (build.stdout || '') + (build.stderr || ''));
    if (build.status !== 0) throw new Error('游戏页面构建失败，请查看启动日志。');
  }
  const token = randomBytes(32).toString('hex');
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, ['backend/src/player.js'], { cwd: root, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, TRPG_LAUNCH_TOKEN: token } });
  fs.closeSync(fd);
  let exited = false;
  child.on('exit', () => {
    exited = true;
    try { if (JSON.parse(fs.readFileSync(metadata, 'utf8')).pid === child.pid) fs.unlinkSync(metadata); } catch {}
  });
  child.on('error', error => fs.appendFileSync(log, String(error)));
  fs.writeFileSync(metadata, JSON.stringify({ pid: child.pid, token }));
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('游戏服务启动失败，请检查API配置和启动日志。');
    const ready = await health();
    if (ready?.pid === child.pid && ready.app === 'ai-trpg-player') { openBrowser(); return; }
    await sleep(500);
  }
  child.kill();
  throw new Error('游戏启动超时，请查看启动日志。');
}
main().catch(error => {
  fs.appendFileSync(log, new Date().toISOString() + ' ' + error.stack + '\n');
  const message = `${error.message}\n日志：${log}`;
  const command = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${message.replace(/'/g, "''")}', 'AI-TRPG')`;
  spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true });
  process.exitCode = 1;
});
