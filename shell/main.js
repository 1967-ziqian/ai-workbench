// 12-源码照搬 · 最小外壳（Electron）
// 目标：装完能直接跑起来，看到三个场景的布局与顶栏；不依赖 10-源码 / 11-最小可运行壳。
// 不做：嵌入真实 DSH 对话（那需要引擎 RPC）。AI 面板先给占位，告诉你接哪里。
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
// 界面就是表格和文字，用不上 GPU。2026-10-27 实测 GPU 缓存初始化偶尔拖启动 5.6s
// （伴随 Gpu Cache Creation failed），禁掉硬件加速一并根治。
app.disableHardwareAcceleration();
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const SCEN_DIR = path.join(ROOT, 'scenarios');
const IS_SELFTEST = process.argv.includes('--selftest');

let win = null;
function LOG(m) { try { require('node:fs').appendFileSync(require('node:path').join(__dirname, 'main.log'), new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} }

// 配置读取：config.json 随仓库发布（示例值），config.local.json 放本机私密配置（不入库）。
// 后者覆盖前者，这样升级 config.json 不会冲掉本机的 token / 真实路径。
function readCfg() {
  const out = {};
  for (const name of ['config.json', 'config.local.json']) {
    try {
      const f = path.join(ROOT, name);
      if (fs.existsSync(f)) Object.assign(out, JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch (e) { /* 坏配置跳过 */ }
  }
  return out;
}

async function selftestLibrary() {
  const out = { allPass: false, checks: {} };
  const C = (k, v) => { out.checks[k] = v === true; };
  const J = async (js) => {
    const raw = await win.webContents.executeJavaScript(js);
    try { return JSON.parse(raw); } catch (e) { return { __raw: String(raw) }; }
  };

  await win.webContents.executeJavaScript("selectScenario('library')");
  // vault 笔记多时逐篇读 frontmatter 会慢（158 篇实测约 6s），等够了再断言，别拿「还在读」当「没有」
  await new Promise((r) => setTimeout(r, 9000));

  // 折叠记忆会藏起子树 → 先清掉再刷新，保证断言看到的是完整树
  const cl = await win.webContents.executeJavaScript(
    "(function(){var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);" +
    "if(k.indexOf('wb.lib.fold')===0){ks.push(k);localStorage.removeItem(k);}}" +
    "var b=document.querySelector('.lib-tree .lib-refresh'); if(b) b.click(); return 'cleared-'+ks.length;})()"
  );
  console.log('SELFTEST_LIB_FOLDCLEAR ' + cl);
  await new Promise((r) => setTimeout(r, 1600));

  // ① 三面板都在 + 树有内容（vault 版：数据源 / 顶层组 / 笔记行）
  const a = await J(
    "(function(){var tree=document.querySelector('.lib-tree'),unit=document.querySelector('.lib-unit'),due=document.querySelector('.lib-due');" +
    "var head=document.querySelector('.lib-head-s');" +
    "return JSON.stringify({tree:!!tree,unit:!!unit,due:!!due,head:head?head.textContent:''," +
    "groups:document.querySelectorAll('.lib-row-dom').length,notes:document.querySelectorAll('.lib-row-unit').length," +
    "warn:(document.querySelector('.lib-warn')||{}).textContent||''," +
    "ph:document.querySelectorAll('.lib-tree .ph,.lib-unit .ph,.lib-due .ph').length});})()"
  );
  console.log('SELFTEST_LIB_PANELS ' + JSON.stringify(a));
  C('three_panels', a.tree === true && a.unit === true && a.due === true);
  // 没配置 libraryRoot 时，「明确提示未配置」本身就是正确行为——纯净环境首次跑自检不该判红，
  // 只验三面板挂上、没有卡在占位，然后跳过内容类断言。
  if (/未配置/.test(a.warn || '')) {
    console.log('SELFTEST_LIB_SKIP 未配置 libraryRoot，跳过内容断言');
    C('no_placeholder', a.ph === 0);
    out.allPass = Object.keys(out.checks).every((k) => out.checks[k] === true);
    return out;
  }
  C('head_source', /数据源/.test(a.head || '') && /篇/.test(a.head || ''));
  C('tree_has_groups', a.groups >= 1);
  C('tree_has_notes', a.notes >= 1);
  C('no_placeholder', a.ph === 0);

  // ② 点一条笔记 → 中栏看清 title / frontmatter / 正文预览 / 跳转
  const clicked = await win.webContents.executeJavaScript(
    "(function(){var r=document.querySelectorAll('.lib-row-unit'); if(!r.length) return 'NO-NOTE-ROW';" +
    "r[0].click(); return 'clicked-'+r.length;})()"
  );
  console.log('SELFTEST_LIB_CLICK ' + clicked);
  await new Promise((r) => setTimeout(r, 1600));
  const b = await J(
    "(function(){var t=document.querySelector('.lib-card-title');var f=document.querySelector('.lib-facts');" +
    "var crumb=document.querySelector('.lib-crumb');var pre=document.querySelector('.lib-quote-pre');" +
    "var link=document.querySelector('.lib-src-row .lib-link');" +
    "return JSON.stringify({title:t?t.textContent:'',facts:f?f.textContent:'',crumb:crumb?crumb.textContent:''," +
    "pre:pre?pre.textContent.length:0,link:link?link.textContent:''});})()"
  );
  console.log('SELFTEST_LIB_UNIT ' + JSON.stringify(b));
  C('unit_title', (b.title || '').length > 0);
  C('unit_facts', /status:/.test(b.facts || ''));
  C('unit_crumb', (b.crumb || '').length > 0);
  C('unit_preview', b.pre > 0);
  C('unit_obsidian_btn', /在 Obsidian 打开/.test(b.link || ''));

  // 外链白名单：obsidian:// 必须放行，否则「在 Obsidian 打开」点了没反应（2026-10-30 修的坑）。
  // 只断言纯函数，不真去拉 Obsidian/浏览器，避免自检带副作用。
  C('ext_allow_obsidian', isAllowedExternal('obsidian://open?vault=Obsidian%20Vault&file=a.md') === true);
  C('ext_allow_https', isAllowedExternal('https://example.com') === true);
  C('ext_deny_file', isAllowedExternal('file:///C:/Windows/System32/calc.exe') === false);
  C('ext_deny_js', isAllowedExternal('javascript:alert(1)') === false);

  // ③ 右栏只做入口：一个「去 Obsidian 复习」按钮 + 说明
  const c = await J(
    "(function(){var go=document.querySelector('.lib-due .lib-go');var note=document.querySelector('.lib-due .lib-note');" +
    "return JSON.stringify({go:go?go.textContent:'',note:note?note.textContent:''});})()"
  );
  console.log('SELFTEST_LIB_DUE ' + JSON.stringify(c));
  C('due_launcher', /Obsidian/.test(c.go || ''));
  C('due_note', /复习在 Obsidian|Spaced Repetition/.test(c.note || ''));

  out.allPass = Object.keys(out.checks).every((k) => out.checks[k] === true);
  return out;
}

function readScenarios() {
  const out = [];
  // 数据目录配置化：用 config.json 的 *Root 覆盖 scenario 里的 root，避免写死绝对路径
  // （开源版不绑定作者机器）。config 未配置则退回 scenario 自带的相对路径。
  const cfg = readCfg();
  const rootMap = {
    'method-library': cfg.methodLibraryRoot || '',
    'self-review': cfg.selfReviewRoot || '',
    'library': cfg.libraryRoot || ''
  };
  if (!fs.existsSync(SCEN_DIR)) return out;
  for (const f of fs.readdirSync(SCEN_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SCEN_DIR, f), 'utf8'));
      j._file = f;
      const dr = rootMap[j.id];
      if (dr) {
        const absRoot = path.isAbsolute(dr) ? dr : path.resolve(ROOT, dr);
        (j.panels || []).forEach((p) => {
          p.root = absRoot;
          if (p.book) p.book = path.join(absRoot, path.basename(p.book));
        });
      }
      out.push(j);
    } catch (e) { /* 跳过坏 json */ }
  }
  // 固定顺序：自我复盘 → 方法库 → 学习 → 图书馆。
  // 本地电脑 / 设计杂活 2026-10-27 按用户要求移除，
  // 原件在 归档\已删\2026-10-27\scenarios-移除前\，要恢复就拷回 scenarios/ 再点顶栏 ⟳。
  // learning / library 原来不在表里 → indexOf 返回 -1 → 被排到 99（最后），
  // 标签顺序乱了。2026-10-30 补上。
  const order = ['self-review', 'method-library', 'library'];
  out.sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return out;
}

function cpuLoad() {
  // 简单采样：1 秒内 idle/total 差值（够用，不引入依赖）
  return new Promise((resolve) => {
    const s1 = os.cpus().map((c) => c.times);
    setTimeout(() => {
      const s2 = os.cpus().map((c) => c.times);
      let idle = 0, total = 0;
      for (let i = 0; i < s1.length; i++) {
        const a = s1[i], b = s2[i];
        idle += b.idle - a.idle;
        total += (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.idle - a.idle) + (b.irq - a.irq);
      }
      resolve(Math.max(0, Math.min(100, Math.round((1 - idle / (total || 1)) * 100))));
    }, 700);
  });
}

function gpuLoad() {
  // 有 N 卡就读真利用率；没有/读不到就返回 null（界面显示 —，不编数）
  return new Promise((resolve) => {
    try {
      const { execFile } = require('node:child_process');
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 4000 }, (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const first = String(stdout).trim().split(/\r?\n/)[0] || '';
          const [util, used, total] = first.split(',').map((x) => Number(String(x).trim()));
          if (!Number.isFinite(util)) return resolve(null);
          resolve({ util, memUsed: used, memTotal: total });
        });
    } catch (e) { resolve(null); }
  });
}

function memPct() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return Math.round((used / total) * 100);
}

ipcMain.handle('app:config', () => {
  const def = { engineUrl: 'http://127.0.0.1:3080/' };
  for (const name of ['config.json', 'config.local.json']) {
    try {
      const f = path.join(ROOT, name);
      if (fs.existsSync(f)) Object.assign(def, JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch (e) { /* 坏配置跳过 */ }
  }
  return def;
});
ipcMain.handle('app:dirs', () => {
  const root = process.env.DSH_HOME || process.env.DSH_ROOT || '';
  const out = { root, home: os.homedir(), shell: ROOT, scenes: path.join(ROOT, 'scenarios') };
  // 工作区：优先环境变量，其次 <DSH根>\..\工作区，再不行用户目录
  let work = process.env.DSH_WORKSPACE || '';
  if (!work) {
    const guess = root ? path.join(root, '..', '..', '工作区') : '';
    work = guess && fs.existsSync(guess) ? guess : os.homedir();
  }
  out.workspace = work;
  return out;
});
ipcMain.handle('app:dshRoot', () => process.env.DSH_HOME || process.env.DSH_ROOT || '');
ipcMain.handle('app:scenarios', () => readScenarios());
ipcMain.handle('app:openPath', async (_e, p) => { if (!p) return { ok: false, why: '空路径' }; return { ok: true, err: await shell.openPath(p) }; });
ipcMain.handle('app:load', async () => ({ cpu: await cpuLoad(), gpu: await gpuLoad(), mem: { usedPct: memPct() } }));
// 外链白名单：只放行 http(s) 与本机 Obsidian 深链。
// 别放开成任意协议 —— file:// / javascript: / ms-msdt: 这类是安全洞。
// 2026-10-30 修：原先只允许 http(s)，把 obsidian:// 一并拦了，界面点「在 Obsidian 打开」静默无反应。
const EXT_URL_OK = /^(https?:\/\/|obsidian:\/\/)/i;
function isAllowedExternal(u) { return EXT_URL_OK.test(String(u || '')); }
ipcMain.handle('app:openExternal', async (_e, url) => {
  if (!isAllowedExternal(url)) return { ok: false, why: '只允许 http(s) 与 obsidian://' };
  try {
    await shell.openExternal(String(url));
    return { ok: true };
  } catch (err) {
    // 协议没注册时 ShellExecute 会抛错；把原因回给界面，别静默失败
    return { ok: false, why: (err && err.message) || '系统打不开该协议' };
  }
});
ipcMain.handle('app:home', () => os.homedir());
ipcMain.handle('webai:open', (_e, key, url, title) => openWebAi(key, url, title));
ipcMain.handle('app:balance', async () => {
  let key = process.env.DEEPSEEK_API_KEY || '';
  try {
    const f = path.join(ROOT, 'config.local.json');
    if (!key && fs.existsSync(f)) key = JSON.parse(fs.readFileSync(f, 'utf8')).deepseekKey || '';
  } catch (e) { /* ignore */ }
  if (!key) return { ok: false, why: '未配置密钥（环境变量 DEEPSEEK_API_KEY 或 config.local.json 的 deepseekKey）' };
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) return { ok: false, why: 'HTTP ' + res.status };
    const j = await res.json();
    const info = (j.balance_infos && j.balance_infos[0]) || {};
    return { ok: true, available: !!j.is_available, total: info.total_balance, currency: info.currency || 'CNY' };
  } catch (e) { return { ok: false, why: e.message }; }
});
ipcMain.handle('app:version', () => ({ app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }));

ipcMain.handle('disk:list', async () => {
  const out = [];
  for (const letter of ['C', 'D', 'E', 'F']) {
    const root = letter + ':\\';
    try {
      if (!fs.existsSync(root)) continue;
      const st = fs.statfsSync(root);
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      out.push({ letter, total, free, usedPct: Math.round((1 - free / total) * 100) });
    } catch (e) { /* 跳过读不到的盘 */ }
  }
  return out;
});
ipcMain.handle('fs:list', async (_e, dir) => {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      dir: d.isDirectory(),
      size: d.isDirectory() ? 0 : (() => { try { return fs.statSync(path.join(dir, d.name)).size; } catch (e) { return 0; } })(),
    }));
    items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return { ok: true, items, dir };
  } catch (e) { return { ok: false, why: e.message }; }
});

ipcMain.handle('fs:read', async (_e, p) => {
  try {
    const st = fs.statSync(p);
    if (st.size > 20 * 1024 * 1024) return { ok: false, why: '文件超过 20 MB' };
    const ext = path.extname(p).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
      return { ok: true, kind: 'image', dataUrl: 'data:image/' + ext.slice(1).replace('jpg', 'jpeg') + ';base64,' + fs.readFileSync(p).toString('base64') };
    }
    if (['.mp4', '.webm'].includes(ext)) {
      return { ok: true, kind: 'video', fileUrl: 'file:///' + p.replace(/\\/g, '/') };
    }
    if (ext === '.pdf') return { ok: true, kind: 'pdf', fileUrl: 'file:///' + p.replace(/\\/g, '/') };
    // .jsonl 必须在这张表里：图书馆的 _catalog.jsonl / units.jsonl / items.jsonl
    // 全是 .jsonl。2026-10-30 漏了它 → 读回来是 {kind:'other'} 没有 text，
    // 树就永远是空的（0 领域 0 单元）——而 fs:list 走的是另一个接口、照样成功，
    // 于是到期面板正常、树面板空白，看着像「还没入库」而不是 bug。
    if (['.md', '.txt', '.json', '.jsonl', '.js', '.mjs', '.css', '.html', '.yml', '.yaml', '.log', '.csv'].includes(ext)) {
      return { ok: true, kind: ext === '.md' ? 'md' : 'text', text: fs.readFileSync(p, 'utf8').slice(0, 200000) };
    }
    return { ok: true, kind: 'other', size: st.size, ext };
  } catch (e) { return { ok: false, why: e.message }; }
});

// 学习场景专用写接口（2026-10-29 新增）
// 白名单不是"顺手"，是这一层唯一的安全边界：界面一旦能写文件，能写的地方必须先框死。
// 框三条：① 路径必须在学习工作区内 ② 只许 .jsonl/.md/.json ③ 单次 ≤2MB。
// 写前把旧内容复制成同名 .bak（覆盖上一次）——对着用户 10-29 定的"备份覆盖旧备份"，不堆时间戳。
// 学习工作区根目录：config.json 的 learnRoot（绝对或相对本插件目录），未配置则用插件目录下的「学习」。
const LEARN_ROOT = (() => {
  const r = readCfg().learnRoot;
  if (!r) return path.join(ROOT, '学习');
  return path.isAbsolute(r) ? r : path.resolve(ROOT, r);
})();
ipcMain.handle('fs:write', async (_e, p, text) => {
  try {
    const abs = path.resolve(String(p || ''));
    const rootAbs = path.resolve(LEARN_ROOT);
    const rel = path.relative(rootAbs, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, why: '越界：只允许写 ' + LEARN_ROOT + ' 里的文件' };
    }
    const ext = path.extname(abs).toLowerCase();
    if (!['.jsonl', '.json', '.md'].includes(ext)) return { ok: false, why: '只允许写 .jsonl / .json / .md' };
    const body = String(text == null ? '' : text);
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > 2 * 1024 * 1024) return { ok: false, why: '单次写入超过 2MB' };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) { try { fs.copyFileSync(abs, abs + '.bak'); } catch (e0) {} }
    fs.writeFileSync(abs, body, 'utf8');
    return { ok: true, bytes };
  } catch (e) { return { ok: false, why: e.message }; }
});

// ── 学习内核通道（2026-10-29 停点协议）────────────────────────
// 壳**不判分、不算到期、不算续点**。那些全在 tools/learn_core.py、learn_store.py 里，
// 由 tools/learn_cli.py 暴露成「stdin 一条 JSON → stdout 一条 JSON」。
// 这里只做转发 + 「超时要说得出话」：超时/起不来/输出不可解析 → code=bridge_error，
// 页面据此显示「未判定」，**不许猜一个对错**（规格判据 30 第 2 条）。
const LEARN_CLI = path.join(ROOT, '..', '..', 'tools', 'learn_cli.py');
const PROTO_JSON = path.join(ROOT, '..', '..', 'tools', 'learn_proto.json');
// 内核对入口允许被环境变量改：验收「主进程没回」要一个故意慢的 CLI。
// 改的是入口路径，不是逻辑——生产路径永远是那一个文件。
const learnCliPath = () => process.env.LEARN_CLI || LEARN_CLI;

function protoCfg() {
  try { return JSON.parse(fs.readFileSync(PROTO_JSON, 'utf8')); } catch (e) { return { v: null, timeout_ms: 4000, _err: e.message }; }
}
function pickPython() {
  const cands = [process.env.LEARN_PYTHON, 'D:/Python/python.exe', 'python'].filter(Boolean);
  for (const c of cands) {
    if (c === 'python') return c;                       // PATH 里的，交给 spawn 报错
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// 串行：learn_store 的 seq 是从磁盘上最后一条 +1 算的，两个 CLI 进程同时写会撞号。
// 一次只跑一个，简单排队就行（课内一问一答，本来也不会真并发）。
let learnChain = Promise.resolve();
function runCli(req) {
  const cfg = protoCfg();
  const timeoutMs = Number(cfg.timeout_ms || 4000) + 1500;   // 给 python 起进程留余量
  const exec = () => new Promise((resolve) => {
    const py = pickPython();
    if (!py) return resolve({ ok: false, code: 'bridge_error', msg: '找不到能跑 learn_cli.py 的 python（可设 LEARN_PYTHON）' });
    if (!fs.existsSync(learnCliPath())) return resolve({ ok: false, code: 'bridge_error', msg: '内核入口不存在：' + learnCliPath() });
    let done = false, out = '', err = '';
    let p;
    // 环境必须显式给 UTF-8：从资源管理器启动的进程继承系统环境（cp936），
    // 而工具会话里注入了 PYTHONUTF8=1——不显式指定，就变成"我这边能跑、双击就报 workdir 越界"。
    const env = Object.assign({}, process.env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    try { p = spawn(py, [learnCliPath()], { windowsHide: true, env }); }
    catch (e) { return resolve({ ok: false, code: 'bridge_error', msg: '起不了 python：' + e.message }); }
    const timer = setTimeout(() => {
      if (done) return; done = true;
      try { p.kill(); } catch (e0) {}
      resolve({ ok: false, code: 'bridge_error', msg: '主进程 ' + timeoutMs + 'ms 内没有回话' });
    }, timeoutMs);
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('error', (e) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: false, code: 'bridge_error', msg: '起不了 python：' + e.message });
    });
    p.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      const line = out.trim().split('\n').filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line)); }
      catch (e) {
        // 内核吐了 traceback 或啥都没吐：这也是「没给出判定」，不是答错
        resolve({ ok: false, code: 'bridge_error',
                  msg: '内核没有可解析的回话（退出码 ' + code + '）：' + (err.trim() || out.trim()).slice(0, 200) });
      }
    });
    try { p.stdin.write(JSON.stringify(req)); p.stdin.end(); } catch (e) { try { p.stdin.end(); } catch (e2) {} }
  });
  const p = learnChain.then(exec, exec);
  learnChain = p.catch(() => {});
  return p;
}

// 课页的 preload 是 sandbox 的：它里面 require('node:fs') 会崩，桥就静默消失了。
// 所以路径推导放在主进程，preload 同步问一次（sendSync，几十微秒，上课不差这点）。
function learnWorkdirOf(href) {
  try {
    const p = require('node:url').fileURLToPath(String(href || ''));
    let d = path.dirname(p);
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(d, 'lessons')) || fs.existsSync(path.join(d, 'items.jsonl'))) return d;
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  } catch (e) { /* fallthrough */ }
  return '';
}
ipcMain.on('learn:where', (e, href) => {
  const wd = learnWorkdirOf(href);
  if (IS_SELFTEST) LOG('learn:where ' + (wd || 'NONE') + ' <- ' + String(href || '').slice(0, 90));
  e.returnValue = wd;
});

ipcMain.handle('learn:call', async (_e, req) => {
  if (!req || typeof req !== 'object') return { ok: false, code: 'bad_req', msg: '入参必须是对象' };
  // 自测时把写入重定向到隔离副本（见 prepareSelftestWd）。只改 workdir，其余参数原样透传。
  // 字段名是 workdir（renderer 的 learnCall 与课页 preload 都用这个名字）；写成 wd 匹配不上，
  // 2026-10-29 实测就是这样静默失效的——隔离看起来加了，真实目录照样被写。
  if (SELFTEST_WD && typeof req.workdir === 'string') {
    const d = req.workdir.replace(/\\/g, '/').replace(SELFTEST_WD.from, SELFTEST_WD.to);
    req = Object.assign({}, req, { workdir: d });
    if (!SELFTEST_WD.logged) { SELFTEST_WD.logged = true; LOG('SELFTEST_WD_REDIRECT ' + d); }
  }
  // 不做任何加工：版本比对在内核里做（learn_cli 读 learn_proto.json）。
  // 页面发的是「本课当初按哪版写的」，内核发的是「现在是什么版本」，两个事实不能在这里合并。
  return runCli(req);
});


ipcMain.handle('mem:inject', async () => {
  let dshRoot = process.env.DSH_ROOT || process.env.DSH_HOME || os.homedir();
  if (!dshRoot) return { ok: false, why: '没检测到 DSH 根目录（可设环境变量 DSH_ROOT）' };
  const res = [];
  const pairs = [
    ['自我复盘', '自我复盘-项目信息.md'],
    ['本地电脑', '本地电脑-项目信息.md'],
    ['设计杂活', '设计杂活-项目信息.md'],
  ];
  for (const [scen, tpl] of pairs) {
    const dir = path.join(dshRoot, '场景项目信息', scen);
    const dst = path.join(dir, '项目信息.md');
    try {
      if (fs.existsSync(dst)) { res.push({ scen, ok: true, skipped: true }); continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(ROOT, '记忆模板', tpl), dst);
      res.push({ scen, ok: true, path: dst });
    } catch (e) { res.push({ scen, ok: false, why: e.message }); }
  }
  return { ok: true, res, root: dshRoot };
});

ipcMain.handle('win:control', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

// ── 网页版 AI 小窗：每站点一个独立窗口（各自登录分区）──
const webaiWins = new Map();
function openWebAi(key, url, title) {
  const old = webaiWins.get(key);
  if (old && !old.isDestroyed()) {
    if (old.isVisible()) { old.hide(); return { ok: true, action: 'hide' }; }
    old.show(); old.focus(); return { ok: true, action: 'show' };
  }
  const w = new BrowserWindow({
    width: 480, height: 760, minWidth: 360, minHeight: 480,
    title: title || key, autoHideMenuBar: true,
    backgroundColor: '#0b0e14',
    webPreferences: { partition: 'persist:webai-' + key, contextIsolation: true, nodeIntegration: false },
  });
  w.loadURL(url);
  w.on('closed', () => webaiWins.delete(key));
  webaiWins.set(key, w);
  return { ok: true, action: 'open' };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 660,
    resizable: true,
    frame: false,
    backgroundColor: '#0a0c12',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // 后台不节流：窗口不在前台时渲染进程会被节流，停止出帧 → capturePage()
      // 只能拿到上一帧旧图。2026-10-28 实测：selftest 四张截图字节数完全相同，
      // 全是同一张旧帧，截图因此不可信（DOM 断言才是硬证据）。
      backgroundThrottling: false,
    },
  });
  LOG('createWindow');
  win.webContents.on('dom-ready', () => LOG('dom-ready'));
  win.webContents.on('did-finish-load', () => LOG('did-finish-load'));
  // 渲染层计时探针：定位启动慢在哪一段（renderer 里 console.log('[boot]' ...) 会被收进来）
  win.webContents.on('console-message', (_e, level, message) => {
    if (String(message).indexOf('[boot]') === 0) LOG(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => LOG('did-fail-load ' + code + ' ' + desc));
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  if (IS_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      let precondFail = false;      // 文档区前置没就绪 → 只跳那条断言，末尾给退出码 2
      try {
        // 引擎视图现在是懒挂载：先切过去，等它挂上、连上再截（验证懒挂载这条链路）
        await win.webContents.executeJavaScript("state.view='engine'; showView();");
        await new Promise((r) => setTimeout(r, 5000));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(ROOT, 'selftest.png'), img.toPNG());
        // 引擎视图已经截完 → 把它卸掉再测场景。
        // 原因：<webview> 会霸占渲染线程（2026-10-27 实测初始化卡 5.6s），
        // 带着它跑后面的文档滚动测试容易出假失败。DS verdict 3 的前置断言
        // 要求「引擎视图不存在」，卸掉是让它真不存在的唯一办法。
        const unmount = await win.webContents.executeJavaScript(
          "(function(){var wv=document.getElementById('engine-webview');" +
          "if(wv&&wv.parentNode){wv.parentNode.removeChild(wv);return 'removed';}" +
          "return 'absent';})()"
        );
        console.log('SELFTEST_ENGINE_UNMOUNT ' + unmount);
        // 再切到第一个场景截一张：复盘场景的「默认打开错题册」「面板布局」只能在这里看出来
        try {
          await win.webContents.executeJavaScript("selectScenario('self-review')");
          await new Promise((r) => setTimeout(r, 1500));
          const img2 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, 'selftest-scene.png'), img2.toPNG());
          // 点第一个条目节点，验证「点条目 → 弹浮层看正文」；首屏不该有浮层，对比两张图即可
          await win.webContents.executeJavaScript(
            "var n=document.querySelector('.rm-item'); if(n) n.dispatchEvent(new MouseEvent('click',{bubbles:true}));"
          );
          await new Promise((r) => setTimeout(r, 1400));
          const img3 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, 'selftest-jump.png'), img3.toPNG());
          // 硬证据：浮层里的长条目能滚（否则长条目看不全）
          const sc2 = await win.webContents.executeJavaScript(
            "(function(){var p=document.querySelector('.rm-pop-md'); if(!p) return 'NO-POP';" +
            "p.scrollTop=400; return 'after='+p.scrollTop+' scrollH='+p.scrollHeight+' clientH='+p.clientHeight;})()"
          );
          console.log('SELFTEST_POP_SCROLL ' + sc2);
          // 再点目录里第二个 md（复盘方法），验证文档模式能滚、返回条常驻
          await win.webContents.executeJavaScript(
            "var f=document.querySelectorAll('.side-file')[1]; if(f) f.click();"
          );
          await new Promise((r) => setTimeout(r, 1400));
          const img4 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, 'selftest-doc.png'), img4.toPNG());
          // 前置正断言：断言「文档区能滚」之前，先确认文档区真的有内容。
          // DS verdict 3 —— 把「测试环境没准备好」报成「功能失败」正是《兜底须分型》在测试层的同形。
          // 不满足 → 报未就绪，**只跳过依赖它的这条断言**，其余场景（尤其方法库）继续跑；
          // 末尾再按前置失败给退出码 2。
          // 为什么不整场中止：整场中止会把后面所有场景的证据一起吞掉，
          // 一次环境没就绪 = 全场无结论，这本身是自检的设计缺陷（2026-10-28 实测：
          // 冷启动时 map 未就绪 → NO-DOC-EL → 方法库断言根本没跑到）。
          // 注意位置：必须在切进文档模式之后 —— .rm-doc 是 showDocMode() 才创建的，
          // 放在切换之前查它，恒为 NO-DOC-EL（2026-10-28 实测误报）。
          const pre = await win.webContents.executeJavaScript(
            "(function(){var d=document.querySelector('.rm-doc');" +
            "var eng=document.getElementById('engine-slot');" +
            "if(!d) return 'NO-DOC-EL';" +
            "if((d.scrollHeight||d.clientHeight)<=0) return 'DOC-EMPTY';" +
            "if(eng && eng.childElementCount>0) return 'ENGINE-PRESENT';" +
            "return 'READY';})()"
          );
          if (pre !== 'READY') {
            console.log('SELFTEST_PRECOND_FAIL ' + pre + ' (仅跳过文档滚动断言，其余继续)');
            precondFail = true;
          } else {
            // 硬证据：文档区真的能滚
            const sc = await win.webContents.executeJavaScript(
              "(function(){var d=document.querySelector('.rm-doc'); if(!d) return 'NO-EL';" +
              "var before=d.scrollTop; d.scrollTop=600; return 'before='+before+' after='+d.scrollTop+' scrollH='+d.scrollHeight+' clientH='+d.clientHeight;})()"
            );
            console.log('SELFTEST_DOC_SCROLL ' + sc);
          }
          // 方法库场景：目录列得出来、正文渲染得出来、身份卡在、点第二条能切过去
          await win.webContents.executeJavaScript("selectScenario('method-library')");
          await new Promise((r) => setTimeout(r, 1600));
          const img5 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(ROOT, 'selftest-method.png'), img5.toPNG());
          const ml = await win.webContents.executeJavaScript(
            "(function(){var n=document.querySelectorAll('.ml-item').length;" +
            "var d=document.querySelector('.ml-doc');" +
            "if(!d) return 'NO-DOC';" +
            "return 'items='+n+' docH='+d.scrollHeight+' cards='+document.querySelectorAll('.ml-id').length+' leftoverPH='+document.querySelectorAll('.ml-wrap .ph').length;})()"
          );
          console.log('SELFTEST_METHOD ' + ml);
          // DOM 是硬证据，截图可能给陈旧帧（窗口非前台时 capturePage 会返旧图）。
          // 直接问渲染层：现在在哪个视图、网格里是哪个面板、有没有方法库容器。
          const st = await win.webContents.executeJavaScript(
            "(function(){var t=document.querySelector('.panel-title');" +
            "var w=document.querySelector('.ml-wrap');" +
            "var all=[];document.querySelectorAll('.panel-title').forEach(function(x){all.push(x.textContent)});" +
            "return 'view='+state.view+' panel='+(t?t.textContent:'NONE')+' wrap='+(w?'YES':'NO')+' titles='+all.join('|');})()"
          );
          console.log('SELFTEST_METHOD_STATE ' + st);
          await win.webContents.executeJavaScript(
            "(function(){var bs=document.querySelectorAll('.ml-item');" +
            "for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf('question-master')>=0){bs[i].click();return 'clicked-'+i;} }" +
            "return 'not-found';})()"
          );
          await new Promise((r) => setTimeout(r, 1200));
          const ml2 = await win.webContents.executeJavaScript(
            "(function(){var c=document.querySelector('.ml-id-name');" +
            "var d=document.querySelector('.ml-doc');" +
            "return 'title='+(c?c.textContent.trim():'NONE')+' docH='+(d?d.scrollHeight:0);})()"
          );
          console.log('SELFTEST_METHOD_SWITCH ' + ml2);
          // 分组与折叠：DOM 断言（截图可能返陈旧帧，DOM 才是硬证据）
          const ml3 = await win.webContents.executeJavaScript(
            "(function(){var gs=document.querySelectorAll('.ml-group');" +
            "var titles=[];for(var i=0;i<gs.length;i++){titles.push(gs[i].querySelector('.ml-group-title').textContent)}" +
            "var items=document.querySelectorAll('.ml-item').length;" +
            "var subs=document.querySelectorAll('.ml-item-sub').length;" +
            "return 'groups='+gs.length+' titles='+titles.join('|')+' items='+items+' subs='+subs;})()"
          );
          console.log('SELFTEST_METHOD_GROUPS ' + ml3);
          // 点「自动化」组头 → 折叠 → 状态落盘 → 再点复原（不改变用户原有界面状态）
          const ml4 = await win.webContents.executeJavaScript(
            "(function(){var hs=document.querySelectorAll('.ml-group');" +
            "for(var i=0;i<hs.length;i++){ if(hs[i].querySelector('.ml-group-title').textContent==='自动化'){" +
            "var b=hs[i].nextElementSibling;" +
            "var before=b.classList.contains('hidden');" +
            "hs[i].click(); var folded=b.classList.contains('hidden');" +
            "var keys=[];for(var j=0;j<localStorage.length;j++){var k=localStorage.key(j); if(k.indexOf('wb.ml.fold')===0) keys.push(k+'='+localStorage.getItem(k));}" +
            "hs[i].click(); var restored=b.classList.contains('hidden');" +
            "return 'before='+before+' folded='+folded+' restored='+restored+' store='+keys.join(',');" +
            "}}" +
            "return 'NO-AUTO-GROUP';})()"
          );
          console.log('SELFTEST_METHOD_FOLD ' + ml4);

          // ── 跨场景跳转（pull + 竞态三件套）────────────────
          // 纯函数层：中文 frontmatter key 能解析；册子条目能取出 id 与 KB 路径。
          const j0 = await win.webContents.executeJavaScript(
            "(function(){var m=parseFrontmatter('---\\nname: x\\n回流自: C-002\\n---\\nbody');" +
            "var b=parseBookMap('## 域\\n### 子\\n#### 条目｜C-002｜复发 1｜状态：待验证\\n正文\\n#### 台账｜KB：方法库/自动化/A1.md｜验证：已验证｜效果：优');" +
            "var a=b[0].subs[0].items[0],c=b[0].subs[0].items[1];" +
            "return 'fm='+(m.meta['回流自']||'NONE')+' id='+(a.id||'NONE')+' kb='+(c.kb||'NONE')+' kbId='+(c.id||'NONE');})()"
          );
          console.log('SELFTEST_JUMP_PARSE ' + j0);
          // 跳回复盘：写意图 + 切场景 → 复盘面板 mount 后自己取 → 定位条目
          const j1 = await win.webContents.executeJavaScript(
            "(function(){var r=JumpBus.request('sb','C-002','self-review');return 'req='+r+' hash='+location.hash;})()"
          );
          console.log('SELFTEST_JUMP_REQ_SB ' + j1);
          await new Promise((r) => setTimeout(r, 1400));
          const j1b = await win.webContents.executeJavaScript(
            "(function(){var t=document.querySelector('.panel-title');" +
            "var fl=document.querySelectorAll('.rm-flash').length;" +
            "var kb=document.querySelectorAll('.rm-kb').length;" +
            "return 'hash='+location.hash+' panel='+(t?t.textContent:'NONE')+' flash='+fl+' kbBadges='+kb;})()"
          );
          console.log('SELFTEST_JUMP_SB ' + j1b);
          // 反向：复盘台账条目的「→库」徽标 → 跳方法库并打开那一条
          const j2 = await win.webContents.executeJavaScript(
            "(function(){var g=document.querySelectorAll('.rm-kb');if(!g.length)return 'NO-BADGE';" +
            "g[0].dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'clicked-'+g.length;})()"
          );
          console.log('SELFTEST_JUMP_REQ_KB ' + j2);
          await new Promise((r) => setTimeout(r, 1800));
          const j2b = await win.webContents.executeJavaScript(
            "(function(){var c=document.querySelector('.ml-id-name');" +
            "var j=document.querySelectorAll('.ml-jump').length;" +
            "return 'hash='+location.hash+' title='+(c?c.textContent.trim():'NONE')+' jumpBtns='+j;})()"
          );
          console.log('SELFTEST_JUMP_KB ' + j2b);
          // 二次跳转必须被拒（限一层，禁 A→B→C）
          const j3 = await win.webContents.executeJavaScript(
            "(function(){location.hash='#kb='+encodeURIComponent('x');" +
            "var r=JumpBus.request('sb','C-001','self-review');var rejected=(r===false);" +
            "JumpBus.fail('kb','selftest-clean');" +
            "return 'rejected='+rejected+' hashAfterClean='+location.hash;})()"
          );
          console.log('SELFTEST_JUMP_NOCHAIN ' + j3);
          // 3 秒无人消费 → 显式报错，不许静默
          const j4 = await win.webContents.executeJavaScript(
            "(function(){var r=JumpBus.request('kb','无人消费',null);return 'req='+r+' hash='+location.hash;})()"
          );
          console.log('SELFTEST_JUMP_REQ_ORPHAN ' + j4);
          await new Promise((r) => setTimeout(r, 3300));
          const j4b = await win.webContents.executeJavaScript(
            "(function(){var t=document.getElementById('status-text');var s=t?t.textContent:'NONE';" +
            "JumpBus.fail('kb','selftest-clean');return 'status='+s;})()"
          );
          console.log('SELFTEST_JUMP_TIMEOUT ' + j4b);
          // ── 图书馆场景 · 三面板验收（vault 直读；数据目录未配置时这几条会红，属预期）──
          try {
            const bl = await selftestLibrary();
            console.log('SELFTEST_LIB ' + JSON.stringify(bl));
            if (!bl.allPass) precondFail = true;
          } catch (e) { console.log('SELFTEST_LIB_FAIL ' + e.message); precondFail = true; }
        } catch (e) { console.log('SELFTEST_SCENE_FAIL ' + e.message); }
        console.log('SELFTEST_OK ' + path.join(ROOT, 'selftest.png'));
      } catch (e) { console.log('SELFTEST_FAIL ' + e.message); }
      app.exit(precondFail ? 2 : 0);
    });
  }
}

app.whenReady().then(() => { LOG('ready'); createWindow(); });
app.on('window-all-closed', () => { LOG('window-all-closed'); app.quit(); });
process.on('uncaughtException', (e) => LOG('uncaught ' + e.message));
