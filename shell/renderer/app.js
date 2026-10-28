/* 12-源码照搬 · 最小外壳的渲染层
   能跑：三场景标签、网格面板、文件浏览与预览、盘容量、负载胶囊、⋯ 菜单
   不能跑：真实 DSH 对话（AI 面板是占位，告诉你去接哪个接口） */
'use strict';

const API = window['kun'];

// 场景标签图标（与完整版同款，内联 SVG）
const SCENE_ICONS = {
  'self-review': "<svg width=\"17\" height=\"17\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M13.1 8A5.1 5.1 0 1 1 11.4 4.1\" stroke=\"#8fb4ff\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M13.5 2.2v3h-3\" stroke=\"#8fb4ff\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"5.6\" y=\"5.9\" width=\"4.8\" height=\"6.2\" rx=\"1\" fill=\"#8fb4ff\" opacity=\".85\"/><rect x=\"6.9\" y=\"7.6\" width=\"2.2\" height=\".9\" rx=\".45\" fill=\"#0b1220\" opacity=\".5\"/><rect x=\"6.9\" y=\"9.4\" width=\"2.2\" height=\".9\" rx=\".45\" fill=\"#0b1220\" opacity=\".5\"/></svg>",
  'method-library': "<svg width=\"17\" height=\"17\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M2.6 3.1a1 1 0 0 1 1-1h3.1c.55 0 1 .45 1 1v9.4a.7.7 0 0 1-.7.7H3.6a1 1 0 0 1-1-1V3.1Z\" stroke=\"#7ee0c4\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><path d=\"M13.4 3.1a1 1 0 0 0-1-1H9.3c-.55 0-1 .45-1 1v9.4a.7.7 0 0 0 .7.7h2.4a1 1 0 0 0 1-1V3.1Z\" stroke=\"#7ee0c4\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><path d=\"M4.1 4.9h1.9M4.1 6.7h1.9M9.9 4.9h1.9M9.9 6.7h1.9\" stroke=\"#7ee0c4\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\".75\"/></svg>",
};

const state = { scenarios: [], current: null, previewTarget: null, view: '' };

// ── 跨场景跳转（pull 模式）──────────────────────────────
// DS 结论：不用事件总线。事件总线是「源推送」——目标面板还没挂载，消息就丢了。
// 改成「目标自取」：点击方只写意图（location.hash）并切场景；
// 目标面板 mount 完成后自己去读 hash，命中就消费掉。
// 竞态三件套：① mount 完成后再读 ② 读到即消费（幂等）③ 3 秒没人消费 → 显式报错，不许静默。
// 限一层：已有未消费的跳转时拒绝新请求（禁 A→B→C 二次跳转）。
// 退化方案（state/跳转.json）没做：外壳是同一个 renderer 页面，hash 足够，少一个真源少一处漂。
const JumpBus = (() => {
  const PREFIX = { kb: '#kb=', sb: '#sb=' };
  const LABEL = { kb: '方法库', sb: '复盘' };
  let watchdog = null;

  const cur = () => {
    const h = String(location.hash || '');
    for (const k in PREFIX) {
      if (h.startsWith(PREFIX[k])) {
        let v = h.slice(PREFIX[k].length);
        try { v = decodeURIComponent(v); } catch (e) { /* 保留原样 */ }
        return { kind: k, value: v };
      }
    }
    return null;
  };

  // 清 hash 用 replaceState：location.hash='' 会再触发一次 hashchange，绕圈。
  const clearHash = () => {
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { location.hash = ''; }
  };

  const disarm = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

  return {
    // 点击方只调这个：写意图 + 切场景。真正的打开由目标面板 pull 完成。
    request(kind, value, switchTo) {
      if (!PREFIX[kind]) return false;
      if (cur()) { setStatus(false, '上一次跳转还没落地，先完成它（不支持连跳）'); return false; }
      location.hash = PREFIX[kind] + encodeURIComponent(String(value == null ? '' : value));
      disarm();
      watchdog = setTimeout(() => {
        watchdog = null;
        const r = cur();
        if (!r) return;                                   // 已被消费：不算失败
        setStatus(false, '跳转没落地：' + (LABEL[r.kind] || r.kind) + ' 面板没接住（3 秒内无人接收）');
      }, 3000);
      if (switchTo) selectScenario(switchTo);             // 切场景会重建面板 → 目标面板重新 mount → 它自己来取
      return true;
    },
    // 目标面板 mount 完成后调：命中就消费掉并返回目标值，没命中返回 null。
    consume(kind) {
      const r = cur();
      if (!r || r.kind !== kind) return null;
      clearHash();
      disarm();
      return r.value;
    },
    // 目标面板接不住时显式报错（不许静默丢）。
    fail(kind, why) {
      const r = cur();
      if (r && r.kind === kind) clearHash();
      disarm();
      setStatus(false, why);
    },
    pending: cur,
  };
})();

// ── 小工具 ─────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKB = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtGB = (n) => (n / 1073741824).toFixed(0) + ' GB';

// ── 顶栏：5 个网页端按钮 ───────────────────────────────
const SITES = [
  { key: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
  { key: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/' },
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { key: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail' },
  { key: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/' },
];
function mountWebAi() {
  const strip = $('#webai-strip');
  if (!strip || strip.children.length) return;
  SITES.forEach((s) => {
    const b = el('button', 'webai-btn');
    b.title = s.name + '（用系统浏览器打开）';
    const img = el('img');
    img.src = 'assets/webai/' + s.key + '.png';
    img.alt = s.name;
    img.draggable = false;
    img.onerror = () => { img.remove(); b.classList.add('noimg'); b.textContent = s.name.slice(0, 1); };
    b.appendChild(img);
    b.addEventListener('click', () => API.webai.open(s.key, s.url, s.name));
    strip.appendChild(b);
  });
}

// ── 启动动画（约 1.6 秒，纯 CSS/JS，无外部资源）────────
function bootAnim() {
  const ov = document.getElementById('boot-overlay');
  const bar = document.getElementById('boot-bar-in');
  const stage = document.getElementById('boot-stage');
  if (!ov) return;
  const steps = ['正在点亮红标志…', '正在检查引擎…', '正在读场景与配置…', '准备开干'];
  let i = 0;
  const pct = document.getElementById('boot-pct');
  if (pct) pct.textContent = '12%';
  bar.style.width = '12%';
  const t = setInterval(() => {
    i++;
    bar.style.width = Math.min(100, 12 + i * 26) + '%';
    if (pct) pct.textContent = Math.min(100, 12 + i * 26) + '%';
    if (stage) stage.textContent = steps[Math.min(i, steps.length - 1)];
    if (i >= 4) {
      clearInterval(t);
      ov.classList.add('done');
      setTimeout(() => ov.remove(), 420);
    }
  }, 380);
}

// ── 余额 + 连接状态 ───────────────────────────────────
async function tickBalance() {
  const chip = document.getElementById('balance-chip');
  if (!chip) return;   // 顶栏余额已被移除（用户要求）
  try {
    const r = await API.app.balance();
    if (r.ok) {
      const sym = r.currency === 'CNY' ? '¥' : '$';
      chip.textContent = sym + Number(r.total).toFixed(2);
      chip.className = 'balance-chip' + (r.available ? ' ok' : ' bad');
      chip.title = 'DeepSeek 余额 ' + r.total + ' ' + r.currency + (r.available ? '' : '（余额不足）');
    } else {
      chip.textContent = '¥ —';
      chip.title = '余额取不到：' + r.why;
    }
  } catch (e) { chip.textContent = '¥ —'; }
}

function setStatus(ok, text) {
  const d = document.getElementById('status-dot');
  const t = document.getElementById('status-text');
  if (d) d.className = 'status-dot' + (ok ? ' ok' : '');
  if (t) t.textContent = text;
}

async function tickLoad() {
  try {
    const r = await API.app.load();
    const p = $('#tbs-load');
    const cpu = typeof r.cpu === 'number' ? r.cpu : null;
    const gpu = r.gpu && typeof r.gpu.util === 'number' ? r.gpu.util : null;
    const gpuMem = r.gpu && r.gpu.memUsed && r.gpu.memTotal ? ('（' + r.gpu.memUsed + '/' + r.gpu.memTotal + ' MB）') : '';
    const mem = r.mem && typeof r.mem.usedPct === 'number' ? r.mem.usedPct : null;
    p.innerHTML = '<span class="tbs-txt"><span class="tbs-k">CPU</span><b>' + (cpu == null ? '—' : cpu + '%') + '</b></span>' +
                  '<span class="tbs-txt"><span class="tbs-k">GPU</span><b>' + (gpu == null ? '—' : gpu + '%') + '</b></span>' +
                  '<span class="tbs-txt"><span class="tbs-k">MEM</span><b>' + (mem == null ? '—' : mem + '%') + '</b></span>';
    p.className = 'tbs-pill tbs-load' + (cpu >= 90 ? ' bad' : cpu >= 70 ? ' warn' : '');
    p.title = '本机负载：CPU ' + (cpu == null ? '—' : cpu + '%') + ' · GPU ' + (gpu == null ? '—' : gpu + '%' + gpuMem) + ' · 内存 ' + (mem == null ? '—' : mem + '%');
  } catch (e) { /* ignore */ }
}

// ── 场景标签 ───────────────────────────────────────────
function renderTabs() {
  const nav = $('#scenario-tabs');
  nav.innerHTML = '';
  const eng = el('button', 'tab collapsible' + (state.view === 'engine' ? ' active' : ''));
  eng.title = 'DeepSeek Harness 原始界面';
  const engIco = el('span', 'tab-ico', '🐋');
  eng.appendChild(engIco);
  eng.appendChild(el('span', 'tab-txt', 'DeepSeek Harness'));
  eng.addEventListener('click', () => { state.view = 'engine'; renderTabs(); showView(); });
  nav.appendChild(eng);
  state.scenarios.forEach((sc) => {
    const b = el('button', 'tab collapsible' + (state.view === sc.id ? ' active' : ''));
    b.title = sc.description || sc.name;
    const ico = el('span', 'tab-ico');
    ico.innerHTML = SCENE_ICONS[sc.id] || '';
    b.appendChild(ico);
    b.appendChild(el('span', 'tab-txt', sc.name));
    b.addEventListener('click', () => selectScenario(sc.id));
    nav.appendChild(b);
  });
}

function selectScenario(id) {
  state.current = state.scenarios.find((s) => s.id === id) || state.scenarios[0] || null;
  state.view = state.current ? state.current.id : 'engine';
  renderTabs();
  showView();
}

// 两个视图互斥：引擎 / 场景网格
function showView() {
  const eng = document.getElementById('engine-view');
  const sc = document.getElementById('scenario-view');
  const onEngine = state.view === 'engine';
  eng.classList.toggle('active', onEngine);
  sc.classList.toggle('active', !onEngine);
  if (onEngine) {
    if (document.getElementById('engine-webview')) loadEngine();
    else mountEngineLater();      // webview 还没挂：等首屏画完再挂
  } else renderGrid();
}

// ── webview 延迟挂载 ──────────────────────────────────
// 实测（2026-10-27）：把 <webview> 直接写进 index.html，光它初始化就吃 5.6 秒，
// 而且这 5.6 秒里整条渲染线程被占住 —— 界面白屏、连 IPC 都跟着晚回。
// 改成：首屏先画完，两帧之后再把它挂进去，引擎在自己那格里后台起。
let engineMounted = false;
function mountEngineLater() {
  if (engineMounted) return;
  engineMounted = true;
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    ensureEngineWebview();
    setStatus(false, '引擎连接中…');   // 挂载那一下会顿一拍，先把话说在前面
    if (state.view === 'engine') loadEngine();
  }, 0)));
}

function ensureEngineWebview() {
  let wv = document.getElementById('engine-webview');
  if (wv) return wv;
  const slot = document.getElementById('engine-slot');
  if (!slot) return null;
  wv = document.createElement('webview');
  wv.id = 'engine-webview';
  wv.setAttribute('src', 'about:blank');
  wv.setAttribute('partition', 'persist:harness');
  wv.setAttribute('allowpopups', '');
  slot.appendChild(wv);
  return wv;
}

// ── 网格与面板 ─────────────────────────────────────────
function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const sc = state.current;
  if (!sc) { grid.appendChild(el('div', 'empty', '没有场景：把 scenarios/*.json 放进来')); return; }
  // 按本场景用到的最大行数铺满（不出现页面级滚动条）
  const maxRow = (sc.panels || []).reduce((m, x) => Math.max(m, (x.row || 1) + (x.h || 1) - 1), 1);
  grid.style.gridTemplateRows = 'repeat(' + maxRow + ', minmax(0, 1fr))';
  (sc.panels || []).forEach((p, i) => { p.__idx = i + 1; grid.appendChild(buildPanel(sc, p)); });
}

function buildPanel(sc, p) {
  const box = el('div', 'panel');
  box.style.gridColumn = (p.col || 1) + ' / span ' + (p.w || 1);
  box.style.gridRow = (p.row || 1) + ' / span ' + (p.h || 1);
  box.dataset.type = p.type || '';
  box.dataset.preview = p.id;   // review-files 靠它找到预览面板（缺这行→默认打开永远失效）

  const head = el('div', 'panel-head');
  const num = el('span', 'panel-num', String(p.__idx || 1));
  num.title = '窗口序号';
  head.appendChild(num);
  head.appendChild(el('span', 'panel-title', p.title || p.id));
  if (p.sub) head.appendChild(el('span', 'panel-sub', p.sub));
  const ptype = String(p.type || '');
  const canExpand = ptype === 'harness' || ptype === 'embed';   // 会话面板 + 内嵌网页都支持向上展开
  const exp = el('button', 'panel-expand', '▲');
  exp.title = '展开到最高（再点一次收起）';
  exp.style.display = canExpand ? '' : 'none';
  head.appendChild(exp);
  box.appendChild(head);

  if (canExpand) {
    let savedGrid = null;
    exp.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const on = !box.classList.contains('panel-expanded');
      if (on) {
        // 记住原格子（grid 定位是内联的，收起时必须还原）
        savedGrid = { col: box.style.gridColumn, row: box.style.gridRow };
        const r = box.getBoundingClientRect();
        const grid = box.parentNode;
        const ph = document.createElement('div');
        ph.className = 'panel-placeholder';
        ph.style.gridColumn = savedGrid.col;
        ph.style.gridRow = savedGrid.row;
        grid.insertBefore(ph, box);
        box.__ph = ph;

        box.classList.add('panel-expanded');
        box.style.position = 'fixed';
        box.style.left = r.left + 'px';
        box.style.width = r.width + 'px';
        box.style.top = (r.top) + 'px';
        box.style.height = r.height + 'px';
        box.style.zIndex = String(900 + (window.__expZ = (window.__expZ || 0) + 1));
        // 强制回流后立刻改目标（不用 rAF：窗口不在前台时 rAF 会被节流）
        void box.offsetHeight;
        box.style.top = '74px';
        box.style.height = (r.bottom - 74) + 'px';
        exp.textContent = '▼';
        exp.title = '收起';
        window.addEventListener('keydown', escClose, { once: true });
      } else {
        const ph = box.__ph;
        const t = ph ? ph.getBoundingClientRect() : null;
        if (t) {
          // 先动画收回原格子，动画结束再解除 fixed
          box.style.top = t.top + 'px';
          box.style.height = t.height + 'px';
        }
        exp.textContent = '▲';
        exp.title = '展开到最高（再点一次收起）';
        setTimeout(() => {
          if (ph) ph.remove();
          box.__ph = null;
          box.classList.remove('panel-expanded');
          box.style.position = '';
          box.style.left = '';
          box.style.width = '';
          box.style.top = '';
          box.style.height = '';
          box.style.zIndex = '';
          if (savedGrid) { box.style.gridColumn = savedGrid.col; box.style.gridRow = savedGrid.row; }
        }, 200);
      }
    });
    function escClose(e) { if (e.key === 'Escape') exp.click(); }
  }
  
  const body = el('div', 'panel-body');
  box.appendChild(body);

  if (ptype === 'review-doc' || ptype === 'view') {
    body.innerHTML = '<div class="ph">点右边的文件，就在这里预览</div>';
    box._show = (f, opt) => showPreview(body, f, opt);
  } else if (ptype === 'review-map') {
    renderMapPanel(body, p, box);        // 左大区：册子思维导图（SVG 手绘）
  } else if (ptype === 'review-side') {
    renderSidePanel(body, p);            // 右窄栏：待验证 + 目录
  } else if (ptype === 'review-usage') {
    renderUsagePanel(body, p);           // 下方：用得怎么样（使用记录聚合）
  } else if (ptype === 'method-lib') {
    renderMethodLib(body, p);            // 方法库：左目录 + 右正文（身份卡 + 全文）
  } else if (ptype === 'review-files' || ptype === 'file') {
    renderFilePanel(body, p);
  } else if (ptype === 'harness') {
    body.innerHTML = '<div class="ph">AI 面板：<b>' + esc(p.sessionTitle || '会话') + '</b><br>' +
      '<small>本最小壳不内嵌对话。接法：把 <code>sessionId</code> 填进 scenarios 的 json，再用你引擎的会话接口渲染到这里。</small></div>';
  } else if (ptype === 'embed') {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:embed-' + p.id);
    wv.setAttribute('allowpopups', '');
    wv.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    wv.src = p.url;
    body.style.padding = '0';
    body.appendChild(wv);
  } else if (ptype === 'reserved') {
    body.innerHTML = '<div class="ph">' + esc(p.reserveNote || '预留面板') + '</div>';
  } else if (ptype.indexOf('pc-') === 0) {
    renderPcPanel(body, ptype);
  } else {
    body.innerHTML = '<div class="ph">未实现的面板类型：<code>' + esc(ptype) + '</code></div>';
  }

  return box;
}

function rememberRecent(file) {
  try {
    const list = JSON.parse(localStorage.getItem('wb.recent') || '[]');
    const next = [{ path: file, at: Date.now() }].concat(list.filter((x) => x.path !== file)).slice(0, 12);
    localStorage.setItem('wb.recent', JSON.stringify(next));
  } catch (e) {}
}

// ── 极简 markdown 渲染（本地零依赖，够看册子）──────────
// 只认这几样：标题 / 加粗斜体 / 行内代码 / 列表 / 引用 / 分隔线 / 表格 / 段落。
// 不做代码高亮、不做脚注 —— 这不是编辑器，是「能读」。
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  let out = '', i = 0, listOpen = null, h4i = 0;
  const closeList = () => { if (listOpen) { out += '</' + listOpen + '>'; listOpen = null; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*$/.test(ln)) { closeList(); i++; continue; }
    // 表格：| a | b | 紧跟一行 |---|---|
    if (/^\s*\|/.test(ln) && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] || '')) {
      closeList();
      const cells = (s) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out += '<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') +
        '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>';
      continue;
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(); const n = h[1].length;
      // 四级标题＝册子条目，带锚点，册子树点一下就能滚到这儿
      const id = n === 4 ? ' id="pv-h4-' + (h4i++) + '"' : '';
      out += '<h' + n + id + '>' + inline(h[2]) + '</h' + n + '>';
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { closeList(); out += '<hr>'; i++; continue; }
    if (/^>\s?/.test(ln)) { closeList(); out += '<blockquote>' + inline(ln.replace(/^>\s?/, '')) + '</blockquote>'; i++; continue; }
    const ul = ln.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (listOpen !== 'ul') { closeList(); out += '<ul>'; listOpen = 'ul'; } out += '<li>' + inline(ul[1]) + '</li>'; i++; continue; }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (listOpen !== 'ol') { closeList(); out += '<ol>'; listOpen = 'ol'; } out += '<li>' + inline(ol[1]) + '</li>'; i++; continue; }
    closeList();
    out += '<p>' + inline(ln) + '</p>';
    i++;
  }
  closeList();
  return out;
}

function showPreview(body, file, opt) {
  rememberRecent(file);
  body.innerHTML = '<div class="ph">读取中…</div>';
  API.fs.read(file).then((r) => {
    if (!r.ok) { body.innerHTML = '<div class="ph">读不了：' + esc(r.why) + '</div>'; return; }
    if (r.kind === 'image') body.innerHTML = '<img class="pv-img" src="' + r.dataUrl + '">';
    else if (r.kind === 'video') body.innerHTML = '<video class="pv-video" src="' + r.fileUrl + '" controls></video>';
    else if (r.kind === 'pdf') body.innerHTML = '<iframe class="pv-frame" src="' + r.fileUrl + '"></iframe>';
    else if (r.kind === 'md') {
      body.innerHTML = '<div class="pv-md">' + mdToHtml(r.text) + '</div>';
      // 册子树点条目 → 滚到对应正文，并临时点亮
      if (opt && typeof opt.h4 === 'number') {
        setTimeout(() => {
          const t = body.querySelector('#pv-h4-' + opt.h4);
          if (!t) return;
          t.scrollIntoView({ block: 'start', behavior: 'smooth' });
          t.classList.add('pv-cur');
          setTimeout(() => t.classList.remove('pv-cur'), 1800);
        }, 40);
      }
    }
    else if (r.kind === 'text') body.innerHTML = '<pre class="pv-text">' + esc(r.text) + '</pre>';
    else body.innerHTML = '<div class="ph">这个类型先不预览（.' + esc(r.ext || '?') + '，' + fmtKB(r.size || 0) + '）</div>';
  });
}

async function renderFilePanel(body, p) {
  let root = p.root || p.launchPath || '';
  if (!root || root.indexOf('<') >= 0) root = await API.app.home();
  const r = await API.fs.list(root);
  if (!r.ok) { body.innerHTML = '<div class="ph">读不了目录：' + esc(r.why) + '</div>'; return; }
  const list = el('div', 'file-list');
  const head = el('div', 'file-row file-row-dir', '📁 ' + r.dir);
  head.addEventListener('click', () => {});
  list.appendChild(head);
  r.items.slice(0, 300).forEach((it) => {
    const row = el('div', 'file-row' + (it.dir ? ' file-row-dir' : ''), (it.dir ? '📁 ' : '📄 ') + it.name + (it.dir ? '' : '  ·  ' + fmtKB(it.size)));
    if (!it.dir) row.addEventListener('click', () => previewInto(it));
    list.appendChild(row);
  });
  body.appendChild(list);

  function previewInto(it) {
    const targetId = p.viewPanel || boxIdForPreview();
    const target = document.querySelector('[data-preview="' + targetId + '"]');
    if (target && target._show) target._show(r.dir.replace(/[\\/]$/, '') + '\\' + it.name);
    else showPreview(body, r.dir.replace(/[\\/]$/, '') + '\\' + it.name);
  }
  function boxIdForPreview() {
    const t = state.current && (state.current.panels || []).find((x) => x.type === 'review-doc' || x.type === 'view');
    return t ? t.id : '';
  }

  // 默认打开：场景配置给了 open 就先预览它（复盘场景默认开错题册）。
  // 预览面板可能排在本面板之后渲染，找不到就稍后重试两次。
  if (p.open) {
    let tries = 0;
    const tryOpen = () => {
      const targetId = p.viewPanel || boxIdForPreview();
      const target = document.querySelector('[data-preview="' + targetId + '"]');
      if (target && target._show) target._show(p.open);
      else if (tries++ < 2) setTimeout(tryOpen, 400);
    };
    tryOpen();
  }
}

// ── 复盘场景 v2：册子导图 / 状态栏 / 用得怎么样 ──────────
// 左区＝错题册横向思维导图，纯 SVG 手绘（零外部库、零联网）；
// 右栏＝待验证清单 + 复盘目录；下方＝使用记录按条目聚合。
// 读 .jsonl：fs:read 的白名单没有 jsonl（未知扩展名只回 kind:'other'，不带正文），
// 壳的 main/preload 不能改 → 用 XHR 直读本地文件兜底（页面本身就是 file:// 源，允许）。
async function readTextFile(p) {
  const r = await API.fs.read(p);
  if (r && r.ok && typeof r.text === 'string') return { ok: true, text: r.text };
  try {
    const text = await new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('GET', 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23'), true);
      x.onload = () => ((x.status === 0 || x.status === 200) ? res(x.responseText) : rej(new Error('HTTP ' + x.status)));
      x.onerror = () => rej(new Error('读不到文件'));
      x.send();
    });
    return { ok: true, text: String(text) };
  } catch (e) { return { ok: false, why: e.message || '读不到' }; }
}

function parseJsonl(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

const trunc = (s, n) => { s = String(s == null ? '' : s); const c = [...s]; return c.length > n ? c.slice(0, n).join('') + '…' : s; };

// 解析册子：复发/状态口径与旧 parseBook 一致，区别有两处——
// ① 保留空领域（教学/毕业论文要画虚线空框，不再 filter 掉）；
// ② 每个条目把正文原文带走（点条目 → 浮层里 mdToHtml 渲染用）。
function parseBookMap(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const doms = [];
  let dom = null, sub = null, cur = null, h4i = 0;
  const ensureDom = () => { if (!dom) { dom = { name: '未分类', subs: [], count: 0, empty: true }; doms.push(dom); } };
  lines.forEach((ln) => {
    let m = ln.match(/^##\s+(.*)$/);
    if (m) { dom = { name: m[1].trim(), subs: [], count: 0, empty: true }; doms.push(dom); sub = null; cur = null; return; }
    m = ln.match(/^###\s+(.*)$/);
    if (m) {
      ensureDom();
      sub = { name: m[1].trim(), items: [], empty: true };
      dom.subs.push(sub); dom.empty = false; cur = null; return;
    }
    m = ln.match(/^####\s+(.*)$/);
    if (m) {
      ensureDom();
      if (!sub) { sub = { name: '未分类', items: [], empty: false }; dom.subs.push(sub); }
      const head = m[1].trim();
      const parts = head.split('｜').map((s) => s.trim());
      let rel = '', status = 'new', id = '', kb = '';
      parts.slice(1).forEach((seg) => {
        const rr = seg.match(/^复发\s*(\d+)/);
        if (rr) rel = rr[1];
        if (/待验证/.test(seg)) status = 'wait';
        else if (/已验证/.test(seg)) status = 'ok';
        else if (/已挂载/.test(seg)) status = 'mount';
        // 条目自身 id：整段就是一个 C-00X（复盘原条目）。
        // 台账条目的 id 在「回流自 C-00X」段里，不算自身 id——两者要分得开，
        // 否则跳 #sb=C-00X 会落到台账条目而不是复盘原条目。
        if (/^C-\d+$/.test(seg)) id = seg;
        // 库路径：KB：方法库/xxx.md（库回流台账条目）。
        // 「KB：—」是待回流的占位，不是有效路径——不拦的话会给它画个「→库」徽标，
        // 点了只会跳到「方法库里找不到：—」（2026-10-28 实测坐实）。
        if (/^KB[:：]/.test(seg)) {
          const v = seg.replace(/^KB[:：]\s*/, '').trim();
          if (v && v !== '—' && v !== '-' && v !== '－') kb = v;
        }
      });
      sub.empty = false; dom.empty = false; dom.count += 1;
      cur = { title: parts[0], rel, status, id, kb, idx: h4i++, full: head, body: [] };
      sub.items.push(cur);
      return;
    }
    if (cur && !/^#/.test(ln)) cur.body.push(ln);
  });
  doms.forEach((d) => (d.subs || []).forEach((s) => (s.items || []).forEach((it) => { it.body = it.body.join('\n').trim(); })));
  return doms;
}

// ── 面板 1｜册子思维导图（review-map）──────────────────
// SVG 小工具 + 文字宽度测量（canvas 量，不引库）
const SVGNS = 'http://www.w3.org/2000/svg';
const RM_FONT = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
const rmCtx = document.createElement('canvas').getContext('2d');
const textWidth = (t, size, weight) => {
  rmCtx.font = (weight ? weight + ' ' : '') + size + 'px ' + RM_FONT;
  return rmCtx.measureText(String(t)).width;
};
const sv = (tag, attrs, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in (attrs || {})) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

// 各层节点的视觉参数：字号 / 加粗 / 左右留白 / 高 / 圆角
const RM_KIND = {
  root: { font: 14, weight: 700, pad: 18, h: 38, rx: 10 },
  dom:  { font: 13, weight: 600, pad: 14, h: 32, rx: 9 },
  sub:  { font: 12, weight: 500, pad: 12, h: 28, rx: 8 },
  item: { font: 12, weight: 400, pad: 12, h: 30, rx: 8 },
};
const RM_COLGAP = 48, RM_VGAP = 12, RM_TITLE_MAX = 12;

async function renderMapPanel(body, p, box) {
  const root = String(p.root || (await API.app.home())).replace(/[\\/]$/, '');
  const bookPath = p.book || (root + '\\错题册.md');
  body.innerHTML = '<div class="ph">读取中…</div>';
  const r = await API.fs.read(bookPath);
  if (!r.ok || !r.text) { body.innerHTML = '<div class="ph">读不了册子：' + esc((r && r.why) || '空文件') + '</div>'; return; }
  const doms = parseBookMap(r.text);
  if (!doms.length) { body.innerHTML = '<div class="ph">册子里还没有条目</div>'; return; }

  // 树结构：错题册 → 领域(##) → 子类(###) → 条目(####)，带父指针供「展开到该节点」回溯
  const tree = { kind: 'root', label: '错题册', ref: null, empty: false, collapsed: false, children: [] };
  doms.forEach((d) => {
    const dn = { kind: 'dom', label: d.name, ref: d, empty: !!d.empty, collapsed: false, children: [] };
    (d.subs || []).forEach((s) => {
      const sn = { kind: 'sub', label: s.name, ref: s, empty: !!s.empty, collapsed: false, children: [] };
      (s.items || []).forEach((it) => sn.children.push({ kind: 'item', label: it.title, rel: it.rel, ref: it, empty: false, collapsed: false, children: [] }));
      dn.children.push(sn);
    });
    tree.children.push(dn);
  });
  (function link(n) { (n.children || []).forEach((c) => { c.parent = n; link(c); }); })(tree);

  // 视图状态：缩放 0.4~2.5，平移 tx/ty；userMoved 后不再自动 fit（尊重用户手位）
  const view = { k: 1, tx: 24, ty: 24 };
  let userMoved = false;
  let mode = 'map';           // 'map'＝导图 / 'doc'＝某份 md 文档
  let tapBlocked = false;     // 拖拽结束后的那次 click 要吞掉，不然拖完顺手折叠了节点
  const gIdx = new Map();     // 条目 idx → { node, g }，右栏「待验证」点过来用

  body.innerHTML = '';
  body.style.overflow = 'hidden';   // 导图自己管缩放平移，不吃 panel-body 的滚动条
  const wrap = el('div', 'rm-wrap');
  const svg = sv('svg', { class: 'rm-svg' });
  const world = sv('g', { class: 'rm-world' });
  const gEdges = sv('g', {}, world);
  const gNodes = sv('g', {}, world);
  svg.appendChild(world);
  wrap.appendChild(svg);

  const applyView = () => world.setAttribute('transform', 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');

  function setZoom(k2, mx, my) {
    k2 = Math.min(2.5, Math.max(0.4, k2));
    const ratio = k2 / view.k;
    view.tx = mx - (mx - view.tx) * ratio;
    view.ty = my - (my - view.ty) * ratio;
    view.k = k2;
    userMoved = true;
    applyView();
  }

  // 滚轮缩放：以鼠标为锚点
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rc = svg.getBoundingClientRect();
    setZoom(view.k * Math.exp(-e.deltaY * 0.0015), e.clientX - rc.left, e.clientY - rc.top);
  }, { passive: false });

  // 按住拖拽平移：移动超 4px 才算拖，结束时挡掉那次 click
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tapBlocked = false;
    const pan = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    const mv = (ev) => {
      const dx = ev.clientX - pan.sx, dy = ev.clientY - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) > 4) pan.moved = true;
      if (pan.moved) { view.tx = pan.tx + dx; view.ty = pan.ty + dy; userMoved = true; applyView(); }
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (pan.moved) tapBlocked = true;
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });

  const displayLabel = (n) => {
    let t = n.kind === 'item' ? trunc(n.label, RM_TITLE_MAX) : n.label;
    if (n.empty) t = n.label + '（空）';
    else if (n.collapsed && n.children.length) t += ' ▸' + n.children.length;
    return t;
  };

  // 布局：横向分层，同层垂直排开，父节点纵向对齐子节点中位。
  // span 是布局占位高度，rectH 是画的框高——父框永远套在子块中线上。
  function layout(n, x, y0) {
    const c = RM_KIND[n.kind];
    n.dlabel = displayLabel(n);
    n.x = x;
    let w = textWidth(n.dlabel, c.font, c.weight) + c.pad * 2;
    if (n.kind === 'item' && n.rel) w += textWidth('复发 ' + n.rel, 10) + 20;
    if (n.kind === 'item' && n.ref.kb) w += 40;   // 「→库」跳转徽标要占位，否则压住文字
    n.w = Math.max(w, 40);
    const kids = (n.collapsed ? [] : n.children) || [];
    if (!kids.length) { n.span = c.h; n.y = y0; return y0 + c.h + RM_VGAP; }
    let y = y0;
    kids.forEach((k) => { y = layout(k, x + n.w + RM_COLGAP, y); });
    n.span = y - y0 - RM_VGAP;
    n.y = y0 + n.span / 2 - c.h / 2;
    return y;
  }

  function bbox() {
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    (function walk(n) {
      const c = RM_KIND[n.kind];
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + c.h);
      if (!n.collapsed) (n.children || []).forEach(walk);
    })(tree);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // 首屏自动 fit：算包围盒缩放到铺满面板，不放大超过 1 倍
  function fitView() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) { requestAnimationFrame(fitView); return; }
    const bb = bbox();
    const pad = 26;
    if (bb.w <= 0 || bb.h <= 0) { view.k = 1; view.tx = pad; view.ty = pad; applyView(); return; }
    view.k = Math.min(1, (W - pad * 2) / bb.w, (H - pad * 2) / bb.h);
    view.tx = (W - bb.w * view.k) / 2 - bb.x * view.k;
    view.ty = (H - bb.h * view.k) / 2 - bb.y * view.k;
    applyView();
  }

  const nodeClass = (n) => 'rm-node rm-' + n.kind +
    (n.kind === 'item' ? ' st-' + (n.ref.status || 'new') : '') +
    (n.empty ? ' empty' : '');

  function drawNode(n) {
    const c = RM_KIND[n.kind];
    if (!n.collapsed) {
      (n.children || []).forEach((k) => {
        const x1 = n.x + n.w, y1 = n.y + c.h / 2;
        const x2 = k.x, y2 = k.y + RM_KIND[k.kind].h / 2;
        const mx = (x1 + x2) / 2;
        sv('path', { d: 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ',' + mx + ' ' + y2 + ',' + x2 + ' ' + y2, class: 'rm-edge' }, gEdges);
      });
    }
    const g = sv('g', { class: nodeClass(n) }, gNodes);
    if (n.kind === 'item') gIdx.set(n.ref.idx, { node: n, g });
    sv('rect', { x: n.x.toFixed(1), y: n.y.toFixed(1), width: n.w.toFixed(1), height: c.h, rx: c.rx }, g);
    const t = sv('text', { x: (n.x + c.pad).toFixed(1), y: (n.y + c.h / 2).toFixed(1), class: 'rm-text' }, g);
    t.textContent = n.dlabel;
    if (n.kind === 'item' && n.rel) {
      const bw = textWidth('复发 ' + n.rel, 10) + 12;
      const bx = n.x + n.w - bw - 8;
      sv('rect', { x: bx.toFixed(1), y: (n.y + c.h / 2 - 8).toFixed(1), width: bw, height: 16, rx: 8, class: 'rm-badge-bg' }, g);
      const bt = sv('text', { x: (bx + bw / 2).toFixed(1), y: (n.y + c.h / 2).toFixed(1), class: 'rm-badge' }, g);
      bt.textContent = '复发 ' + n.rel;
    }
    // 「→库」徽标：库回流台账里的条目能直接跳到方法库对应条目。
    // 跳转走 JumpBus（写 hash + 切场景），真正的打开由方法库面板 mount 后自己取。
    if (n.kind === 'item' && n.ref.kb) {
      const bw = 30, bh = 16;
      const relW = n.rel ? textWidth('复发 ' + n.rel, 10) + 20 : 0;
      const bx = n.x + n.w - bw - 8 - relW;
      const bg = sv('rect', { x: bx.toFixed(1), y: (n.y + c.h / 2 - bh / 2).toFixed(1), width: bw, height: bh, rx: 8, class: 'rm-kb-bg' }, g);
      const bt = sv('text', { x: (bx + bw / 2).toFixed(1), y: (n.y + c.h / 2).toFixed(1), class: 'rm-kb' }, g);
      bt.textContent = '→库';
      const go = (e) => {
        e.stopPropagation();
        if (tapBlocked) { tapBlocked = false; return; }
        JumpBus.request('kb', n.ref.kb, 'method-library');
      };
      bg.addEventListener('click', go);
      bt.addEventListener('click', go);
    }
    sv('title', {}, g).textContent = n.kind === 'item' ? (n.ref.full || n.label) : n.dlabel;
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tapBlocked) { tapBlocked = false; return; }
      if (n.kind === 'item') { openPop(n); return; }
      if (!n.children.length) return;
      n.collapsed = !n.collapsed;
      render();
    });
    if (!n.collapsed) (n.children || []).forEach(drawNode);
  }

  function render(refit) {
    layout(tree, 0, 0);
    gEdges.innerHTML = '';
    gNodes.innerHTML = '';
    gIdx.clear();
    drawNode(tree);
    if (refit === undefined ? !userMoved : refit) fitView();
    else applyView();
  }

  // 浮层：点条目节点 → 就地弹小窗渲染该条正文，不跳走整个视图
  const pop = el('div', 'rm-pop');
  const closePop = () => { pop.classList.remove('open'); };
  function openPop(n) {
    pop.classList.remove('open');
    pop.innerHTML = '';
    const hd = el('div', 'rm-pop-head');
    hd.appendChild(el('span', 'rm-pop-title', n.label));
    // DS verdict 4 硬规则：字段缺失不许静默渲染成「无状态」，必须显式标出缺什么
    let stText;
    if (!n.ref) stText = '缺字段：ref';
    else if (typeof n.ref.status === 'undefined') stText = '缺字段：status';
    else stText = (n.ref.status === 'ok' ? '已验证'
                 : n.ref.status === 'wait' ? '待验证'
                 : n.ref.status === 'mount' ? '已挂载'
                 : n.ref.status === 'new' ? '未知状态：new'
                 : n.ref.status);
    const meta = el('span', 'rm-pop-meta',
      (n.rel ? '复发 ' + n.rel + ' · ' : '') + stText);
    hd.appendChild(meta);
    const x = el('button', 'rm-pop-close', '×');
    x.title = '关闭（Esc）';
    x.addEventListener('click', closePop);
    hd.appendChild(x);
    const bd = el('div', 'pv-md rm-pop-md');
    bd.innerHTML = n.ref.body ? mdToHtml(n.ref.body) : '<p>这条还没有写正文。</p>';
    pop.appendChild(hd); pop.appendChild(bd);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const pw = Math.min(480, W - 16);
    const sx = n.x * view.k + view.tx, sy = n.y * view.k + view.ty;
    let left = sx + n.w * view.k + 14;
    if (left + pw > W - 8) left = sx - pw - 14;
    left = Math.min(Math.max(8, left), Math.max(8, W - pw - 8));
    pop.style.left = left + 'px';
    pop.style.width = pw + 'px';
    pop.style.top = '8px';
    pop.classList.add('open');
    requestAnimationFrame(() => {
      const ph = pop.offsetHeight;
      pop.style.top = Math.min(Math.max(8, sy - 14), Math.max(8, H - ph - 8)) + 'px';
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  wrap.appendChild(pop);
  closePop();   // 首屏必须关着：只有用户点条目节点才开（浮层不自己弹）

  // 点导图空白处（不是节点）顺手收起浮层；节点 click 里 stopPropagation，不会误关
  svg.addEventListener('click', (e) => { if (e.target === svg || e.target === world) closePop(); });

  // 右上角小工具条
  const bar = el('div', 'rm-toolbar');
  const zoomStep = (f) => setZoom(view.k * f, wrap.clientWidth / 2, wrap.clientHeight / 2);
  const bIn = el('button', 'rm-tb', '＋'); bIn.title = '放大'; bIn.addEventListener('click', () => zoomStep(1.25));
  const bOut = el('button', 'rm-tb', '－'); bOut.title = '缩小'; bOut.addEventListener('click', () => zoomStep(0.8));
  const bFit = el('button', 'rm-tb rm-tb-fit', '适应'); bFit.title = '缩放到铺满面板';
  bFit.addEventListener('click', () => { userMoved = false; fitView(); });
  bar.appendChild(bIn); bar.appendChild(bOut); bar.appendChild(bFit);
  wrap.appendChild(bar);

  // 面板尺寸变了：没动过手位就跟着重新铺满
  new ResizeObserver(() => { if (!userMoved && mode === 'map') fitView(); }).observe(wrap);

  // 目录联动：左区两种模式——导图 / 某个 md 文档
  // 文档模式必须能滚：外层 shell 固定「← 回导图」，正文放进独立滚动区（.rm-doc），
  // 不能把返回条一起卷走，也不能沿用导图那套 overflow:hidden 的定位。
  function showDocMode(path) {
    mode = 'doc';
    closePop();
    body.style.overflow = 'hidden';
    body.innerHTML = '';
    const shell = el('div', 'rm-doc-shell');
    const back = el('button', 'rm-back', '← 回导图');
    back.addEventListener('click', showMapMode);
    const doc = el('div', 'rm-doc');
    shell.appendChild(back);
    shell.appendChild(doc);
    body.appendChild(shell);
    showPreview(doc, path);
  }
  function showMapMode() {
    mode = 'map';
    body.style.overflow = 'hidden';
    body.innerHTML = '';
    body.appendChild(wrap);
    render();
  }

  // 右栏点「待验证」条目 → 沿父链全部展开，重排，把节点摆到面板中间，闪两下
  function reveal(idx) {
    closePop();
    if (mode !== 'map') showMapMode();
    const hit = gIdx.get(idx);
    if (!hit) return;
    let anc = hit.node.parent;
    while (anc) { anc.collapsed = false; anc = anc.parent; }
    render(false);
    const n = hit.node, c = RM_KIND[n.kind];
    const W = wrap.clientWidth, H = wrap.clientHeight;
    view.k = Math.min(2.5, Math.max(view.k, 0.8));
    view.tx = W / 2 - (n.x + n.w / 2) * view.k;
    view.ty = H / 2 - (n.y + c.h / 2) * view.k;
    userMoved = true;
    applyView();
    const g = gIdx.get(idx).g;
    g.classList.add('rm-flash');
    setTimeout(() => g.classList.remove('rm-flash'), 1900);
  }

  box._map = { reveal, showDoc: showDocMode, showMap: showMapMode };
  box._show = (f) => showDocMode(f);   // 兼容 data-preview 的旧调用习惯

  body.appendChild(wrap);
  render();

  // 跨场景跳转（pull）：等面板画完再取 hash——DS 竞态三件套之一：mount 完成后再读。
  // 找不到条目要显式报错，不许静默（否则点了没反应都不知道）。
  const sb = JumpBus.consume('sb');
  if (sb) {
    let hit = null;
    for (const d of (doms || [])) {
      for (const s of (d.subs || [])) {
        for (const it of (s.items || [])) if (it.id === sb) { hit = it; break; }
        if (hit) break;
      }
      if (hit) break;
    }
    if (hit) reveal(hit.idx);
    else JumpBus.fail('sb', '复盘里找不到条目 ' + sb + '（id 对不上？）');
  }
}

// ── 面板 2｜状态（review-side）────────────────────────
// 上块「待验证」：status=wait 的条目，最多 5 条；点一条 → 左区导图展开并高亮。
// 下块「目录」：复盘目录下的 .md（jsonl 是机器读的流水，不上墙）。
async function renderSidePanel(body, p) {
  const root = String(p.root || (await API.app.home())).replace(/[\\/]$/, '');
  const bookPath = p.book || (root + '\\错题册.md');
  const bookName = bookPath.split(/[\\/]/).pop();
  const mapApi = () => { const b = document.querySelector('.panel[data-type="review-map"]'); return b && b._map; };
  const withMap = (fn) => {
    const api = mapApi();
    if (api) { fn(api); return; }
    let tries = 0;
    const t = () => { const a = mapApi(); if (a) fn(a); else if (tries++ < 8) setTimeout(t, 250); };
    t();
  };

  body.innerHTML = '<div class="ph">读取中…</div>';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.overflow = 'hidden';
  const r = await API.fs.read(bookPath);
  body.innerHTML = '';
  if (!r.ok || !r.text) { body.innerHTML = '<div class="ph">读不了册子：' + esc((r && r.why) || '') + '</div>'; return; }

  const waits = [];
  parseBookMap(r.text).forEach((d) => (d.subs || []).forEach((s) => (s.items || []).forEach((it) => { if (it.status === 'wait') waits.push(it); })));

  const blk1 = el('div', 'side-block');
  blk1.appendChild(el('div', 'side-cap', '待验证'));
  if (!waits.length) blk1.appendChild(el('div', 'side-empty', '没有待验证的条目'));
  waits.slice(0, 5).forEach((it) => {
    const row = el('button', 'side-wait');
    row.appendChild(el('span', 'side-wait-title', it.title));
    if (it.rel) row.appendChild(el('span', 'side-rel', '复发 ' + it.rel));
    row.title = it.full || it.title;
    row.addEventListener('click', () => withMap((api) => api.reveal(it.idx)));
    blk1.appendChild(row);
  });
  if (waits.length > 5) blk1.appendChild(el('div', 'side-more', '还有 ' + (waits.length - 5) + ' 条'));
  body.appendChild(blk1);

  const blk2 = el('div', 'side-block side-grow');
  blk2.appendChild(el('div', 'side-cap', '目录'));
  const fl = await API.fs.list(root);
  if (!fl.ok) blk2.appendChild(el('div', 'side-empty', '读不了目录：' + esc(fl.why)));
  else {
    const mds = fl.items.filter((x) => !x.dir && /\.md$/i.test(x.name));
    mds.sort((a, b) => (a.name === bookName ? -1 : b.name === bookName ? 1 : a.name.localeCompare(b.name)));
    mds.forEach((f) => {
      const isBook = f.name === bookName;
      const row = el('button', 'side-file' + (isBook ? ' active' : ''));
      row.textContent = f.name;
      row.title = f.name;
      row.addEventListener('click', () => {
        blk2.querySelectorAll('.side-file.active').forEach((x) => x.classList.remove('active'));
        row.classList.add('active');
        withMap((api) => (isBook ? api.showMap() : api.showDoc(root + '\\' + f.name)));
      });
      blk2.appendChild(row);
    });
  }
  body.appendChild(blk2);
}

// ── 面板 3｜用得怎么样（review-usage）──────────────────
// 使用记录.jsonl 按条目聚合：提醒 X（真提醒过的）· 还犯 Y（是否复发）。
// 口径：漏提醒＝机制没跑，不算「提醒过」，也不算还犯（方法文档 2026-10-27 定）。
// 不显示条目总数、不显示百分比——条目数是虚荣指标，不进界面。
async function renderUsagePanel(body, p) {
  const root = String(p.root || (await API.app.home())).replace(/[\\/]$/, '');
  body.innerHTML = '<div class="ph">读取中…</div>';
  const [ck, us] = await Promise.all([
    readTextFile(root + '\\体检.jsonl'),
    readTextFile(root + '\\使用记录.jsonl'),
  ]);
  body.innerHTML = '';
  const head = el('div', 'usage-head');
  let checked = '';
  if (ck.ok) {
    const last = parseJsonl(ck.text).pop();
    if (last && last.checked_at) checked = String(last.checked_at);
  }
  head.appendChild(el('span', 'usage-checked', checked ? '最近体检 ' + checked : '没有体检记录'));
  body.appendChild(head);
  if (!us.ok) { body.appendChild(el('div', 'usage-empty', '读不了使用记录：' + esc(us.why))); return; }
  const recs = parseJsonl(us.text).filter((x) => x && x['条目']);
  if (!recs.length) { body.appendChild(el('div', 'usage-empty', '还没有使用记录——下次开工被提醒才会记')); return; }
  const agg = new Map();
  recs.forEach((x) => {
    const key = String(x['条目']);
    let a = agg.get(key);
    if (!a) { a = { title: key, remind: 0, offend: 0, leak: 0, last: '' }; agg.set(key, a); }
    // 口径与 tools/book_state.py 一致：有触发且不是「（该提醒未提醒）」才算真提醒；
    // 漏提醒单独计，它说的是入口失灵，不进「还犯」。
    const trig = String(x['触发'] || '').trim();
    if (trig && trig.indexOf('未提醒') < 0) a.remind += 1;
    if (x['漏提醒'] === true) a.leak += 1;
    if (x['是否复发'] === true) a.offend += 1;
    const ts = String(x.ts || '');
    if (ts > a.last) a.last = ts;
  });
  head.appendChild(el('span', 'usage-note', '样本 ' + recs.length + ' 条' +
    (recs.length < 5 ? '，暂看不出趋势' : '')));
  const list = el('div', 'usage-list');
  [...agg.values()].sort((a, b) => b.last.localeCompare(a.last)).forEach((a) => {
    const row = el('div', 'usage-row');
    row.appendChild(el('span', 'usage-title', trunc(a.title, 16)));
    row.appendChild(el('span', 'usage-nums', '提醒 ' + a.remind + ' · 还犯 ' + a.offend));
    // L 非零才出现：不喧宾夺主，但坏了一眼能看见
    if (a.leak) row.appendChild(el('span', 'usage-leak', '机制 L=' + a.leak + '（入口失灵）'));
    row.title = a.title;
    list.appendChild(row);
  });
  body.appendChild(list);
}

// ── 方法库（method-lib）──────────────────────────────
// 左：方法目录（库里每个 .md 一条）｜右：正文（身份卡 + 方法全文）
// 人看这个页面，AI 直接读同一批 .md —— 源文件只有一份，两端不打架。
// 做成单面板内部左右分栏，不拆成两个面板：跨面板要处理渲染顺序竞态，
// 单面板天然没有这坑，而且首屏就有内容（默认打开 _INDEX.md），不会开出一片空白。
const ML_INDEX = '_INDEX.md';

// 解析 frontmatter：--- 之间的 key: value，行内列表（- xxx）归到上一个 key。
// 只认这几个形状：标量值、多行列表。不做完整 YAML——方法文件是人写的，
// 复杂结构直接改用正文表格，别让渲染器替作者猜。
function parseFrontmatter(md) {
  const s = String(md == null ? '' : md).replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: s };
  const meta = {};
  let key = null;
  m[1].split('\n').forEach((line) => {
    // key 允许中文：方法库的 frontmatter 有「回流自」这类中文键，
    // 只认 [A-Za-z_] 的话这些行会被整段忽略（2026-10-28 实测坐实）。
    const km = line.match(/^([A-Za-z_一-龥][A-Za-z0-9_\-一-龥]*):[ \t]*(.*)$/);
    if (km) { key = km[1]; meta[key] = km[2].trim(); return; }
    const lm = line.match(/^[ \t]*-[ \t]+(.*)$/);
    if (lm && key) { meta[key] = (meta[key] ? meta[key] + '\n' : '') + lm[1].trim(); }
  });
  return { meta, body: s.slice(m[0].length) };
}

// 画正文：身份卡（frontmatter 渲染成人看得懂的条目）+ 方法全文。
// 没有 frontmatter 的文件（比如 _INDEX.md）直接出正文，不硬造一张空卡。
function paintMethodDoc(docEl, fileName, text) {
  docEl.innerHTML = '';
  const { meta, body } = parseFrontmatter(text);
  const card = el('div', 'ml-id');
  if (meta.title || meta.name) {
    const t = el('div', 'ml-id-name');
    t.appendChild(document.createTextNode(meta.title || meta.name));
    if (meta.name && meta.title && meta.name !== meta.title) t.appendChild(el('span', 'ml-id-slug', meta.name));
    card.appendChild(t);
  }
  if (meta.description) card.appendChild(el('div', 'ml-id-desc', meta.description));
  [['何时用', meta.triggers], ['何时不用', meta['when-not']], ['出处', meta.source]].forEach((pair) => {
    const k = pair[0], v = pair[1];
    if (!v) return;
    const row = el('div', 'ml-id-row' + (v.indexOf('\n') >= 0 ? ' block' : ''));
    row.appendChild(el('span', 'ml-id-k', k));
    const val = el('span', 'ml-id-v');
    if (v.indexOf('\n') >= 0) {
      const ul = el('ul', 'ml-id-list');
      v.split('\n').forEach((x) => { if (x) ul.appendChild(el('li', '', x)); });
      val.appendChild(ul);
    } else val.textContent = v;
    row.appendChild(val);
    card.appendChild(row);
  });
  // 回流自：点它跳回复盘对应条目（双向限一层：A→B→C 不许连跳）。
  const backRef = String(meta['回流自'] || '').trim();
  if (backRef) {
    const cm = backRef.match(/C-\d+/);
    const row = el('div', 'ml-id-row');
    row.appendChild(el('span', 'ml-id-k', '回流自'));
    const val = el('span', 'ml-id-v');
    if (cm) {
      const b = el('button', 'ml-jump', cm[0]);
      b.title = '跳回复盘 ' + cm[0];
      b.addEventListener('click', () => JumpBus.request('sb', cm[0], 'self-review'));
      val.appendChild(b);
      const rest = backRef.replace(cm[0], '').trim();
      if (rest) val.appendChild(document.createTextNode(' ' + rest));
    } else {
      val.textContent = backRef;
    }
    row.appendChild(val);
    card.appendChild(row);
  }
  if (card.childNodes.length) docEl.appendChild(card);
  const md = el('div', 'pv-md ml-md');
  md.innerHTML = mdToHtml(body);
  docEl.appendChild(md);
}

// 分组：按 frontmatter 的 type 走，顺序固定。
// 目录是给人的直觉，type 是给页面的分组键，两个独立维度——缺一个都会乱。
const ML_GROUPS = [
  { key: 'method', title: '方法' },
  { key: 'automation', title: '自动化' },
  { key: 'material', title: '素材' },
  { key: 'doc', title: '文档' },
];

// 折叠状态存这个面板自己的 state（键＝面板 id＋组名），不写工作台全局配置，
// 所以动方法库页面不影响工作台其他面板的行为。
const mlFoldKey = (pid, g) => 'wb.ml.fold.' + pid + '.' + g;
const mlFolded = (pid, g) => { try { return localStorage.getItem(mlFoldKey(pid, g)) === '1'; } catch (e) { return false; } };
const mlSetFold = (pid, g, v) => { try { localStorage.setItem(mlFoldKey(pid, g), v ? '1' : '0'); } catch (e) {} };

// 递归扫 .md（最多 3 层）。方法库现在分 方法/ 自动化/ 素材/ 三个子目录，
// 页面要能扫到子目录里的条目，而不是只列根目录。
async function mlScan(dir, root, depth, out) {
  const fl = await API.fs.list(dir);
  if (!fl.ok) return;
  for (const it of fl.items) {
    if (it.dir) {
      if (depth < 3) await mlScan(dir + '\\' + it.name, root, depth + 1, out);
    } else if (/\.md$/i.test(it.name)) {
      const sub = dir.slice(root.length).replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
      out.push({ name: it.name, path: dir + '\\' + it.name, rel: sub ? sub + '/' + it.name : it.name });
    }
  }
}

async function renderMethodLib(body, p) {
  const root = String(p.root || (await API.app.home())).replace(/[\\/]$/, '');
  body.innerHTML = '<div class="ph">读取中…</div>';
  body.style.display = 'flex';
  body.style.padding = '0';
  body.style.overflow = 'hidden';
  const wrap = el('div', 'ml-wrap');
  const nav = el('div', 'ml-nav');
  const doc = el('div', 'ml-doc');
  body.innerHTML = '';            // 清掉「读取中…」占位，否则它会留在左栏顶上
  wrap.appendChild(nav);
  wrap.appendChild(doc);
  body.appendChild(wrap);

  const fl = await API.fs.list(root);
  if (!fl.ok) {
    nav.appendChild(el('div', 'ml-empty', '读不了目录：' + esc(fl.why)));
    doc.appendChild(el('div', 'ph', '读不了方法库目录：' + esc(fl.why)));
    return;
  }
  const found = [];
  await mlScan(root, root, 1, found);
  if (!found.length) {
    nav.appendChild(el('div', 'ml-empty', '库里还没有 .md'));
    doc.appendChild(el('div', 'ph', '方法库是空的：往 <code>' + esc(root) + '</code> 放几个 .md 就会出现在这里'));
    return;
  }

  // 读每篇的 frontmatter：拿 type 分组、拿 title 当显示名。
  const files = [];
  for (const f of found) {
    const r = await readTextFile(f.path);
    const meta = r.ok ? parseFrontmatter(r.text).meta : {};
    const raw = String(meta.type || '').trim().toLowerCase();
    const type = ML_GROUPS.some((g) => g.key === raw) ? raw : 'doc';
    files.push({
      name: f.name, path: f.path, rel: f.rel, meta: meta, type: type,
      text: r.ok ? r.text : '', ok: r.ok,
      label: meta.title || f.name.replace(/\.md$/i, ''),
    });
  }

  const groups = ML_GROUPS.map((g) => ({ g: g, items: [] }));
  files.forEach((f) => { groups.find((x) => x.g.key === f.type).items.push(f); });
  groups.forEach((x) => {
    x.items.sort((a, b) => (
      a.name === ML_INDEX ? -1 : b.name === ML_INDEX ? 1 : a.label.localeCompare(b.label, 'zh')
    ));
  });

  const pid = String(p.id || 'ml');
  const btns = [];
  const bodies = {};
  const heads = {};

  const open = async (f) => {
    doc.innerHTML = '';
    if (!f.ok) { doc.appendChild(el('div', 'ph', '读不了 ' + esc(f.rel) + '：文件读不到')); return; }
    paintMethodDoc(doc, f.name, f.text);
    doc.scrollTop = 0;
  };

  nav.appendChild(el('div', 'ml-cap', '方法目录'));
  groups.forEach((x) => {
    if (!x.items.length) return;
    const folded = mlFolded(pid, x.g.key);
    const head = el('button', 'ml-group' + (folded ? ' folded' : ''));
    const caret = el('span', 'ml-group-caret', folded ? '▸' : '▾');
    head.appendChild(caret);
    head.appendChild(el('span', 'ml-group-title', x.g.title));
    head.appendChild(el('span', 'ml-group-count', String(x.items.length)));
    const bodyEl = el('div', 'ml-group-body');
    bodies[x.g.key] = bodyEl;
    heads[x.g.key] = head;
    if (folded) bodyEl.classList.add('hidden');
    head.addEventListener('click', () => {
      const willShow = bodyEl.classList.contains('hidden');
      bodyEl.classList.toggle('hidden', !willShow);
      head.classList.toggle('folded', !willShow);
      caret.textContent = willShow ? '▾' : '▸';
      mlSetFold(pid, x.g.key, !willShow);
    });
    x.items.forEach((f) => {
      const b = el('button', 'ml-item');
      b.appendChild(el('span', 'ml-item-label', f.label));
      b.appendChild(el('span', 'ml-item-sub', f.rel));
      b.title = f.rel;
      b.addEventListener('click', () => {
        btns.forEach((y) => y.classList.remove('active'));
        b.classList.add('active');
        open(f);
      });
      f.btn = b;
      btns.push(b);
      bodyEl.appendChild(b);
    });
    nav.appendChild(head);
    nav.appendChild(bodyEl);
  });

  // 默认打开 _INDEX（库身份）；它不在库里就退第一条
  let dflt = null;
  groups.forEach((x) => x.items.forEach((f) => { if (!dflt && f.name === (p.default || ML_INDEX)) dflt = f; }));
  if (!dflt) { for (const x of groups) { if (x.items.length) { dflt = x.items[0]; break; } } }
  if (dflt) {
    if (dflt.btn) dflt.btn.classList.add('active');
    // 默认条目所在分组若是折着的，展开它（不然正文有内容、左栏却看不见选中项）
    const gk = dflt.type;
    if (bodies[gk] && bodies[gk].classList.contains('hidden')) {
      bodies[gk].classList.remove('hidden');
      heads[gk].classList.remove('folded');
      heads[gk].querySelector('.ml-group-caret').textContent = '▾';
    }
    await open(dflt);
  }

  // 跨场景跳转（pull）：面板画完再取 hash——DS 竞态三件套之一：mount 完成后再读。
  // 目标不在库里要显式报错，不许静默。
  const kb = JumpBus.consume('kb');
  if (kb) {
    // 台账里写的是「方法库/自动化/A1-xxx.md」，剥掉库名前缀去匹配相对路径；也兼容绝对路径。
    const rel = String(kb).split('方法库/').pop().replace(/^[\\/]+/, '');
    const target = files.find((f) => f.rel === rel) || files.find((f) => f.path === kb);
    if (target) {
      const gk = target.type;
      if (bodies[gk] && bodies[gk].classList.contains('hidden')) {
        bodies[gk].classList.remove('hidden');
        heads[gk].classList.remove('folded');
        const car = heads[gk].querySelector('.ml-group-caret');
        if (car) car.textContent = '▾';
        mlSetFold(pid, gk, false);
      }
      btns.forEach((y) => y.classList.remove('active'));
      if (target.btn) target.btn.classList.add('active');
      await open(target);
    } else {
      JumpBus.fail('kb', '方法库里找不到：' + rel);
    }
  }
}

async function renderPcPanel(body, type) {
  if (type === 'pc-drives') {
    // 定时刷新：一天一次（够用，不折腾）；另点面板任意处立即重查
    let busy = false;
    const draw = async () => {
      if (!body.isConnected || busy) return;
      busy = true;
      try {
        const disks = await API.app.disks();
        if (!disks.length) { body.innerHTML = '<div class="ph">没读到磁盘</div>'; return; }
        body.innerHTML = '';
        const wrap = el('div', 'drives');
        const totalAll = disks.reduce((a, d) => a + d.total, 0);
        const freeAll = disks.reduce((a, d) => a + d.free, 0);
        const head = el('div', 'drives-head');
        head.innerHTML = '<span>总容量 ' + fmtGB(totalAll) + '</span><span>可用 ' + fmtGB(freeAll) +
          '</span><span>已用 ' + Math.round((1 - freeAll / totalAll) * 100) + '%</span>' +
          '<span class="drives-ts">' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' 采样 · 点击刷新</span>';
        body.appendChild(head);
        disks.forEach((d) => {
          const cls = d.usedPct >= 90 ? 'bad' : d.usedPct >= 70 ? 'warn' : 'ok';
          const C = 2 * Math.PI * 26;
          const off = C * (1 - d.usedPct / 100);
          const card = el('div', 'drive');
          card.innerHTML =
            '<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="ring-bg"/>' +
            '<circle cx="32" cy="32" r="26" class="ring-fg ' + cls + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>' +
            '<div class="drive-k">' + d.letter + ':</div>' +
            '<div class="drive-pct ' + cls + '">' + d.usedPct + '%</div>' +
            '<div class="drive-meta">剩 ' + fmtGB(d.free) + ' / ' + fmtGB(d.total) + '</div>';
          wrap.appendChild(card);
        });
        body.appendChild(wrap);
      } finally {
        busy = false;
      }
      setTimeout(draw, 24 * 60 * 60 * 1000);
    };
    draw();
    body.style.cursor = 'pointer';
    body.title = '点击重新采样磁盘用量';
    body.addEventListener('click', (e) => { e.stopPropagation(); draw(); });
  } else if (type === 'pc-toplarge' || type === 'pc-junk' || type === 'pc-ledger') {
    body.innerHTML = '<div class="ph">' + (type === 'pc-toplarge' ? '大户排行' : type === 'pc-junk' ? '可清理体检' : '清理台账') +
      '：需要外壳提供扫描接口（本最小壳不含）。</div>';
  } else {
    body.innerHTML = '<div class="ph">未实现：' + esc(type) + '</div>';
  }
}

// ── 顶栏交互 ───────────────────────────────────────────
function mountTopbar() {
  const dragArea = document.querySelector('.titlebar-drag');
  if (dragArea) dragArea.addEventListener('dblclick', () => API.win.control('max'));
  $('#btn-min').addEventListener('click', () => API.win.control('min'));
  $('#btn-max').addEventListener('click', () => API.win.control('max'));
  $('#btn-close').addEventListener('click', () => API.win.control('close'));
  $('#btn-refresh').addEventListener('click', async () => { await loadScenarios(); });
  const fb = document.getElementById('btn-folder');
  if (fb) {
    const menu = el('div', 'tb-more-panel folder-menu');
    menu.id = 'folder-menu';
    document.body.appendChild(menu);
    fb.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (menu.style.display === 'block') { menu.style.display = 'none'; return; }
      const d = await API.app.dirs();
      const items = [
        { label: '工作区', path: d.workspace },
        { label: 'DSH 根目录', path: d.root },
        { label: '场景目录', path: d.scenes },
      ].filter((x) => x.path);
      menu.innerHTML = '';
      // 最近打开的文件（点过预览的）
      let recent = [];
      try { recent = JSON.parse(localStorage.getItem('wb.recent') || '[]'); } catch (e) {}
      if (recent.length) {
        const cap = el('div', 'folder-cap', '最近打开');
        menu.appendChild(cap);
        recent.slice(0, 8).forEach((it) => {
          const name = it.path.split(/[\\/]/).pop();
          const row = el('button', 'tb-more-item recent', name);
          row.title = it.path;
          row.addEventListener('click', async (ev3) => {
            ev3.stopPropagation();
            menu.style.display = 'none';
            const target = document.querySelector('.panel[data-type="review-doc"] .panel-body, .panel[data-type="view"] .panel-body');
            if (target) showPreview(target, it.path);
            else { const r = await API.app.openPath(it.path); if (r && r.err) alert('打不开：' + r.err); }
          });
          menu.appendChild(row);
        });
        menu.appendChild(el('div', 'folder-sep'));
      }
      items.forEach((it) => {
        const row = el('button', 'tb-more-item', it.label);
        row.title = it.path;
        row.addEventListener('click', async (ev2) => {
          ev2.stopPropagation();
          menu.style.display = 'none';
          const r = await API.app.openPath(it.path);
          if (r && r.err) alert('打不开：' + r.err);
        });
        menu.appendChild(row);
      });
      const rect = fb.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = Math.round(rect.left) + 'px';
      menu.style.top = Math.round(rect.bottom + 6) + 'px';
      menu.style.right = 'auto';
      menu.style.display = 'block';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });
  }
  $('#btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    const p = $('#tb-more-panel');
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', () => { $('#tb-more-panel').style.display = 'none'; });
  (function initTabnumLabel() {
    let on = false;
    try { on = localStorage.getItem('wb.tabnum') === '1'; } catch (e) {}
    const b = document.querySelector('[data-act="tabnum"]');
    if (b) b.textContent = '窗口序号：' + (on ? '开' : '关');
  })();

  $('#tb-more-panel').addEventListener('click', async (e) => {
    const act = e.target && e.target.dataset && e.target.dataset.act;
    if (!act) return;
    $('#tb-more-panel').style.display = 'none';
    if (act === 'ver') {
      const v = await API.app.version();
      alert('工作台 ' + v.app + '\nElectron ' + v.electron + '\nChromium ' + v.chrome);
    } else if (act === 'mem') {
      const r = await API.app.injectMemory();
      if (!r.ok) alert('注入失败：' + r.why);
      else alert('记忆模板：\n' + r.res.map((x) => x.scen + ' → ' + (x.skipped ? '已存在，跳过' : x.path)).join('\n'));
    } else if (act === 'theme-cycle') {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      setTheme(next);
      const b = document.querySelector('[data-act="theme-cycle"]');
      if (b) b.textContent = '外观：' + (next === 'dark' ? '深色' : '浅色') + '（点击切换）';
    } else if (act === 'tabnum') {
      const on = !(localStorage.getItem('wb.tabnum') === '1');
      try { localStorage.setItem('wb.tabnum', on ? '1' : '0'); } catch (e) {}
      applyPanelNums();
      const b = document.querySelector('[data-act="tabnum"]');
      if (b) b.textContent = '窗口序号：' + (on ? '开' : '关');
    } else if (act === 'onboard') {
      showOnboard(true);
    } else if (act === 'dir') {
      API.app.openPath('.');
    }
  });
}

// ── 引擎视图（默认） ───────────────────────────────────
// 2026-10-26 重写连接逻辑。原实现「设完 src 就固定等 6 秒，到点没落地就判未连接」，
// webview 冷启动（起 GPU/网络栈 + 读 persist 分区）常常超过 6 秒 ⇒ 明明引擎活着却被判死，
// 只能手点重试；点第二次时缓存已热，秒开 —— 这就是"老要点重试"的来源。
// 现在改成：① 先探活（轮询，最多 10 秒；探不到也不判死，交给 webview 自己试）
// ② 导航后等落地（每轮最多 25 秒）③ 主 frame 失败自动重试 3 次
// ④ 全程只在 4 轮都失败后才弹遮罩 ⑤ 状态写进窗口标题，任务栏可见。
let engineLoaded = false;
let engineBusy = false;
const engineSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function engineReachable(url, totalMs) {
  const end = Date.now() + totalMs;
  for (;;) {
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (e) {
      if (Date.now() >= end) return false;
      await engineSleep(800);
    }
  }
}

// 连接状态顺带写进窗口标题：任务栏一眼能看出引擎通没通，也方便外部只读观测
function setEngineState(s) {
  document.title = '子谦的工作台 · ' + s;
}

function engineShowOff(msg) {
  const off = document.getElementById('engine-off');
  const t = document.getElementById('engine-off-msg');
  if (t) t.textContent = msg;
  off.style.display = 'flex';
  setStatus(false, '引擎未连接');
  setEngineState('引擎未连接');
}

async function loadEngine() {
  if (engineBusy) return;
  engineBusy = true;
  const wv = document.getElementById('engine-webview');
  const off = document.getElementById('engine-off');
  if (!wv) { engineBusy = false; return; }   // webview 还没挂上，等 mountEngineLater 回调来叫
  try {
    if (engineLoaded) { off.style.display = 'none'; setEngineState('引擎已连接'); return; }

    const cfg = await API.app.config();
    let url = cfg.engineUrl || 'http://127.0.0.1:3080/';
    if (cfg.engineToken) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(cfg.engineToken);
    document.getElementById('engine-off-url').textContent = url.replace(/token=[^&]+/, 'token=***');

    off.style.display = 'none';
    setStatus(false, '引擎连接中…');
    setEngineState('引擎连接中');

    // ① 探活（最多 10 秒）：只是提前知道引擎在不在，探不到也不判死 —— 照旧交给 webview 自己试，
    //    免得 fetch 被安全策略拦掉时反而永远连不上（退化行为 = 等更久 + 自动重试，不会比原来差）。
    await engineReachable(url, 10000);

    // ② 导航 + 等落地（最多 4 轮，每轮 25 秒）
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      let navFailed = false;
      const onFail = (e) => { if (e && e.isMainFrame === false) return; navFailed = true; };
      wv.addEventListener('did-fail-load', onFail);
      let done = false;
      const onFinish = () => { done = true; };
      wv.addEventListener('did-finish-load', onFinish);
      // 首轮用原始 url（不额外加参数，避免引擎不认）；重试时才加 cache-buster
      const target = attempt === 1 ? url : url + (url.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();
      try { wv.src = target; } catch (e) { navFailed = true; }

      const end = Date.now() + 25000;
      let landed = false;
      for (;;) {
        await engineSleep(500);
        let u = '';
        try { u = wv.getURL() || ''; } catch (e) { u = ''; }
        const ok = !!u && u !== 'about:blank' && u.indexOf('127.0.0.1:3080') >= 0;
        if (done || ok) { landed = true; break; }
        if (navFailed) break;
        if (Date.now() >= end) break;
      }
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('did-finish-load', onFinish);

      if (landed) {
        engineLoaded = true;
        off.style.display = 'none';
        setStatus(true, 'Harness 已连接');
        setEngineState('引擎已连接');
        return;
      }
      if (attempt < 4) {
        setStatus(false, '引擎连接中…（第 ' + attempt + ' 次重试）');
        setEngineState('引擎连接中（重试 ' + attempt + '）');
        await engineSleep(3000);
      }
    }
    engineLoaded = false;
    engineShowOff('引擎端口通着，但页面一直没加载出来。点重试再试一次；反复如此就重启 boot.cjs（node boot.cjs）或重启 DSH 引擎。');
  } finally {
    engineBusy = false;
  }
}

function bindEngineRetry() {
  const b = document.getElementById('engine-retry');
  if (!b) return;
  b.onclick = () => {
    document.getElementById('engine-off').style.display = 'none';
    engineLoaded = false;
    engineBusy = false;
    loadEngine();
  };
}
bindEngineRetry();

// ── 顶栏两个外部应用按钮：幕布 / WorkBuddy ─────────────
async function mountExtGroup() {
  const launch = async (label, exe) => {
    const r = await API.app.openPath(exe);
    if (r && r.err) alert('打不开 ' + label + '：' + r.err + '\n路径：' + exe);
  };
  const b1 = document.getElementById('btn-mubu');
  const b2 = document.getElementById('btn-workbuddy');
  if (b1) b1.onclick = () => launch('幕布', 'D:/幕布/Mubu/幕布.exe');
  if (b2) b2.onclick = () => launch('WorkBuddy', 'C:/Users/Administrator/AppData/Local/Programs/WorkBuddy/WorkBuddy.exe');
}

// ── 外观（深/浅/跟随系统）─────────────────────────────
function applyTheme(mode) {
  const root = document.documentElement;
  const sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const t = mode === 'auto' ? (sysLight ? 'light' : 'dark') : mode;
  root.setAttribute('data-theme', t);
  try { localStorage.setItem('wb.theme', mode); } catch (e) {}
}
function setTheme(mode) { applyTheme(mode); }
function restoreTheme() {
  let mode = 'dark';
  try { mode = localStorage.getItem('wb.theme') || 'dark'; } catch (e) {}
  applyTheme(mode);
}

// ── 引导（首次打开显示；⋯ 里也能重开）───────────────
const ONBOARD_PROMPT = [
  '我在用一个小工作台外壳（Electron），目录：<把这里换成 12-源码照搬\\外壳 的真实路径>。',
  '请你读它的《引导.md》，然后替我把配置填好，不要问我能不能，直接做：',
  '1. 探测：我的 DSH 根目录（含 .dsh 的那层）、dsh web 的地址与 token。',
  '2. 写 <外壳>\\config.local.json：{"engineUrl":"http://127.0.0.1:3080/","engineToken":"<token>"}（有 DEEPSEEK_API_KEY 就加 deepseekKey）。',
  '3. 建三个会话：自我复盘 / 本地电脑 / 设计杂活，把 session id 填进 scenarios 下对应 json 的 sessionId。',
  '4. 把 scenarios 里的占位符换成我机器上真实目录；拿不准的保留并列给我。',
  '5. 校验三个 json 能 JSON.parse；config.local.json 不进 git。',
  '6. 按四行汇报：填了什么 / 会话 id / 改了哪些文件 / 还缺什么。',
  '⛔ 不许改 main.js / preload.js / renderer 下的代码。'
].join('\n');

function showOnboard(force) {
  const mask = document.getElementById('onboard');
  if (!mask) return;
  let done = false;
  try { done = localStorage.getItem('wb.onboarded') === '1'; } catch (e) {}
  if (!force && done) return;
  mask.style.display = 'flex';
}
function mountOnboard() {
  const mask = document.getElementById('onboard');
  if (!mask) return;
  document.getElementById('ob-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ONBOARD_PROMPT); } catch (e) {}
    document.getElementById('ob-copy').textContent = '已复制 ✓';
    setTimeout(() => { document.getElementById('ob-copy').textContent = '复制给 DSH 的提示词'; }, 1600);
  });
  document.getElementById('ob-guide').addEventListener('click', async () => {
    const d = await API.app.dirs();
    const r = await API.app.openPath(d.shell + '\\引导.md');
    if (r && r.err) alert('打不开引导：' + r.err);
  });
  document.getElementById('ob-close').addEventListener('click', () => {
    mask.style.display = 'none';
    try { localStorage.setItem('wb.onboarded', '1'); } catch (e) {}
  });
  setTimeout(() => showOnboard(false), 1600);   // 等启动动画走完再弹
}

function applyPanelNums() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  let on = false;
  try { on = localStorage.getItem('wb.tabnum') === '1'; } catch (e) {}
  grid.classList.toggle('show-num', on);
}

// ── 启动 ───────────────────────────────────────────────
async function loadScenarios() {
  state.scenarios = await API.app.scenarios();
  if (!state.current || !state.scenarios.find((s) => s.id === state.current.id)) {
    state.current = state.scenarios[0] || null;
    // 默认进第一个场景（复盘），不默认开引擎视图：
    // webview 挂载实测会占渲染线程 ~5.6s，没点 🐋 就不该替它付这笔钱
    state.view = state.current ? state.current.id : 'engine';
  }
  renderTabs();
  if (state.view === 'engine') showView(); else renderGrid();
  $('#status-text').textContent = state.scenarios.length + ' 个场景';
}

(async function boot() {
  const T0 = performance.now();
  const mark = (s) => console.log('[boot] ' + s + '=' + Math.round(performance.now() - T0) + 'ms');
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) console.log('[boot] dcl=' + Math.round(nav.domContentLoadedEventEnd) + 'ms load=' + Math.round(nav.loadEventEnd) + 'ms');
  restoreTheme(); mark('restoreTheme');
  bootAnim(); mark('bootAnim');
  mountWebAi(); mark('mountWebAi');
  mountOnboard(); mark('mountOnboard');
  mountTopbar(); mark('mountTopbar');
  tickLoad(); mark('tickLoad-发起');
  setInterval(tickLoad, 4000);
  tickBalance();
  setInterval(tickBalance, 300000);
  await loadScenarios();
  mark('scenarios');
  mountExtGroup();
  showView();
  applyPanelNums();
  mark('first-paint-ready');
})();
