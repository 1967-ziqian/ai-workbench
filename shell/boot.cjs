// 工作台启动器（开源版）：确保 DSH web 引擎在跑 → 把 token 写进 config.local.json → 拉起 Electron 外壳。
// 用法：node boot.cjs   （config.json 里配置 dshCmd / 数据目录；密钥走环境变量 DEEPSEEK_API_KEY）
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = __dirname;
const PORT = 3080;
// DSH 引擎命令：优先 config.json 的 dshCmd，其次环境变量 DSH_CMD，最后回退 dsh（需在 PATH）。
const DSH_CMD = (() => {
  try { const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).dshCmd; if (c) return c; } catch (e) {}
  return process.env.DSH_CMD || 'dsh';
})();
const ENGINE_LOG = path.join(ROOT, 'engine.log');
const CONFIG = path.join(ROOT, 'config.local.json');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const log = (m) => fs.appendFileSync(path.join(ROOT, 'boot.log'), new Date().toISOString() + ' ' + m + '\n');

function portOpen() {
  return new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1');
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
    s.setTimeout(1200, () => done(false));
  });
}

function readToken() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')).engineToken || ''; } catch { return ''; }
}

function writeToken(t) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch {}
  cfg.engineUrl = 'http://127.0.0.1:' + PORT + '/';
  cfg.engineToken = t;
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

async function tokenValid(t) {
  if (!t) return false;
  try {
    const r = await fetch('http://127.0.0.1:' + PORT + '/?token=' + encodeURIComponent(t), { redirect: 'manual' });
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    return sc.length > 0;
  } catch { return false; }
}

function readApiKey() {
  // 开源版：密钥只从环境变量 DEEPSEEK_API_KEY 注入（不读本地密钥文件，避免泄露）。
  // 没有 key 时引擎收得到消息但答不了（报 MISSING_CREDENTIAL），属正常。
  return process.env.DEEPSEEK_API_KEY || '';
}

function startEngine() {
  try { fs.unlinkSync(ENGINE_LOG); } catch {}
  // 直接给 stdio 传文件描述符，别在命令行里拼重定向（cmd 对引号+中文路径会拆坏）
  const fd = fs.openSync(ENGINE_LOG, 'w');
  const key = readApiKey();
  const env = { ...process.env };
  if (key) env.DEEPSEEK_API_KEY = key;
  log('startEngine key=' + (key ? 'yes' : 'no'));
  const p = spawn('cmd.exe', ['/c', DSH_CMD, '--profile', 'web', '--no-open', '--port', String(PORT)], {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env,
  });
  p.unref();
}

function waitToken(ms) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      let txt = '';
      try { txt = fs.readFileSync(ENGINE_LOG, 'utf8'); } catch {}
      const m = txt.match(/token=([A-Za-z0-9_\-]{16,})/);
      if (m) return resolve(m[1]);
      if (Date.now() > end) return resolve('');
      setTimeout(tick, 500);
    };
    tick();
  });
}

function startShell() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 宿主会带这个变量，带进去 ipcMain 就没了
  // 9222 = 本地调试端口，给 WorkBuddy 接管壳里的网页 AI 窗口用（读 DOM、填输入框、抓回答）。
  // 只绑 127.0.0.1，仅本机进程可连；不想要就删掉这个参数，壳照常跑。
  const p = spawn(ELECTRON, ['.', '--remote-debugging-port=9222'], { cwd: ROOT, detached: true, stdio: 'ignore', env, windowsHide: false });
  p.unref();
}

(async () => {
  log('boot start');
  let token = readToken();
  const open = await portOpen();
  log('port open=' + open + ' token=' + (token ? 'has' : 'none'));

  if (open && (await tokenValid(token))) {
    log('engine already up, token ok');
  } else {
    if (!open) { log('starting engine'); startEngine(); }
    else log('engine up but token stale -> restarting for a fresh token');
    if (open) { // 端口占用但 token 失效：杀旧的再起
      spawn('cmd.exe', ['/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :' + PORT + ' ^| findstr LISTENING\') do taskkill /PID %a /F >nul 2>&1'], { stdio: 'ignore', windowsHide: true, shell: true });
      await new Promise((r) => setTimeout(r, 2500));
      startEngine();
    }
    const fresh = await waitToken(60000);
    if (!fresh) { log('FAILED: no token in 60s'); process.exit(1); }
    writeToken(fresh);
    token = fresh;
    log('token refreshed');
  }
  startShell();
  log('shell started');
})();
