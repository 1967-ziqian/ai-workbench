/* 图书馆 · 纯逻辑层（不碰 DOM，可被 node 直接 require 做自测）
   职责只有四件事：解析锚点、解析材料路径、算卡片数、把 catalog + units 拼成一棵树。
   **树不落盘**（规格硬规则 3）：这里每次现算，算完即用。
   领域/主题来自文献层（_catalog.jsonl），单元层级来自内容层（units.jsonl 的 parent），
   三者都不是「树文件」。 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.LibModel = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 旧 jsonl 模型的材料根目录（parseAnchor/absSource/countCards/buildTree 那一套，
  // 图书馆改「直读 vault」后已不再调用；保留函数仅为兼容，根目录不写死任何人的路径）。
  var ROOT = '';

  // 锚点：'L11-L25' → [11,25]；'L11' → [11,11]；起止反了或格式不对 → null
  function parseAnchor(a) {
    var m = /^L(\d+)(?:-L(\d+))?$/.exec(String(a == null ? '' : a).trim());
    if (!m) return null;
    var s = parseInt(m[1], 10);
    var e = m[2] ? parseInt(m[2], 10) : s;
    if (!(s >= 1) || e < s) return null;
    return [s, e];
  }

  // 材料路径：相对路径 → 绝对路径（旧 jsonl 模型用；根目录见上方 ROOT，已不指向任何人的机器）
  // （catalog 里的 path 本来就是绝对路径，别混用这两个）
  function absSource(src) {
    var p = String(src == null ? '' : src).trim();
    if (!p) return '';
    if (/^[A-Za-z]:[\\/]/.test(p)) return p.replace(/\\/g, '/');
    return (ROOT + '/' + p).replace(/\\/g, '/');
  }

  // 卡片计数：items 的 lesson 装的是 unit_id
  function countCards(items, units) {
    var byUnit = {};
    var ids = {};
    (units || []).forEach(function (u) { ids[u.id] = true; });
    (items || []).forEach(function (it) {
      var l = it && it.lesson;
      if (l && ids[l]) byUnit[l] = (byUnit[l] || 0) + 1;
    });
    return byUnit;
  }

  var KIND_ORDER = { principle: 0, method: 1, example: 2, note: 3 };

  function kindRank(k) {
    var r = KIND_ORDER[k];
    return r === undefined ? 9 : r;
  }

  function sumSub(node) {
    var units = 1, cards = node.nCards || 0;
    (node.children || []).forEach(function (c) {
      var s = sumSub(c);
      units += s.nUnits;
      cards += s.nCards;
    });
    node.nUnits = units;
    node.nCards = cards;
    return { nUnits: units, nCards: cards };
  }

  // 树构建
  //   catalogRows : _catalog.jsonl 的行（只要 domain / topic / state / title / lines / folder）
  //   unitsByDomain: { 领域目录名: [单元...] }（单元归属看它自己的 domain，不看目录）
  //   cardsByUnit : { unit_id: 卡片数 }
  function buildTree(catalogRows, unitsByDomain, cardsByUnit) {
    var cards = cardsByUnit || {};
    var usable = (catalogRows || []).filter(function (r) {
      return r && r.domain && (r.state === 'raw' || r.state === 'unitized');
    });

    // 所有单元摊平（目录只是"住在哪"，归属看 unit.domain）
    var allUnits = [];
    Object.keys(unitsByDomain || {}).forEach(function (k) {
      (unitsByDomain[k] || []).forEach(function (u) {
        if (u && u.id) allUnits.push(u);
      });
    });

    // 领域集合：文献层有的 + 内容层有的
    var doms = {};
    usable.forEach(function (r) { doms[r.domain] = true; });
    allUnits.forEach(function (u) { if (u.domain) doms[u.domain] = true; });

    var domainNames = Object.keys(doms).sort();

    var out = domainNames.map(function (dom) {
      var docs = usable.filter(function (r) { return r.domain === dom; });
      var units = allUnits.filter(function (u) { return u.domain === dom; });

      // 主题集合：文献层 (domain,topic) + 内容层 (domain,topic)
      var topicNames = {};
      docs.forEach(function (r) { topicNames[r.topic || '未分主题'] = true; });
      units.forEach(function (u) { topicNames[u.topic || '未分主题'] = true; });

      var byId = {};
      units.forEach(function (u) { byId[u.id] = u; });

      // 单元节点
      var nodeOf = {};
      units.forEach(function (u) {
        nodeOf[u.id] = {
          id: u.id,
          uid: u.id,
          title: u.title || '(未命名)',
          kind: u.kind || 'note',
          topic: u.topic || '未分主题',
          domain: u.domain,
          docDomain: u.doc_domain || '',
          anchor: u.anchor || '',
          summary: u.summary || '',
          status: u.status || '',
          source: u.source || '',
          dupOf: u.dup_of || '',
          parent: u.parent || '',
          nCards: cards[u.id] || 0,
          children: []
        };
      });

      // 挂树：parent 空 = 主题下的根单元；否则挂到父节点下
      var roots = [];
      units.forEach(function (u) {
        var node = nodeOf[u.id];
        var p = u.parent || '';
        if (p && nodeOf[p]) nodeOf[p].children.push(node);
        else roots.push(node);
      });

      function sortUnits(list) {
        list.sort(function (a, b) {
          var ka = kindRank(a.kind), kb = kindRank(b.kind);
          if (ka !== kb) return ka - kb;
          return String(a.id).localeCompare(String(b.id));
        });
        list.forEach(function (n) { sortUnits(n.children); });
      }
      sortUnits(roots);

      var topics = Object.keys(topicNames).map(function (tn) {
        var tDocs = docs.filter(function (r) { return (r.topic || '未分主题') === tn; });
        var tUnits = roots.filter(function (n) { return n.topic === tn; });
        var t = {
          id: 't:' + dom + '/' + tn,
          name: tn,
          nDocs: tDocs.length,
          nUnits: 0,
          nCards: 0,
          units: tUnits
        };
        tUnits.forEach(function (n) { sumSub(n); });
        t.nUnits = tUnits.reduce(function (a, n) { return a + n.nUnits; }, 0);
        t.nCards = tUnits.reduce(function (a, n) { return a + n.nCards; }, 0);
        return t;
      });
      topics.sort(function (a, b) {
        if (b.nUnits !== a.nUnits) return b.nUnits - a.nUnits;
        if (b.nDocs !== a.nDocs) return b.nDocs - a.nDocs;
        return a.name.localeCompare(b.name);
      });

      var d = {
        id: 'd:' + dom,
        name: dom,
        nDocs: docs.length,
        nUnits: 0,
        nCards: 0,
        topics: topics
      };
      d.nUnits = topics.reduce(function (a, t) { return a + t.nUnits; }, 0);
      d.nCards = topics.reduce(function (a, t) { return a + t.nCards; }, 0);
      return d;
    });

    // 领域排序：材料多的在前，其次单元多的，再次名字
    out.sort(function (a, b) {
      if (b.nDocs !== a.nDocs) return b.nDocs - a.nDocs;
      if (b.nUnits !== a.nUnits) return b.nUnits - a.nUnits;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  // 把某条原文按 anchor 区间切出来（行号从 1 起）
  function sliceAnchor(text, anchor) {
    var rng = parseAnchor(anchor);
    if (!rng) return null;
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    if (rng[0] > lines.length) return null;
    return lines.slice(rng[0] - 1, Math.min(rng[1], lines.length));
  }

  // ══════════════════════════════════════════════════════════════
  // Obsidian vault 层（2026-10-30 新增）：frontmatter 解析 + 树 + URI
  // ══════════════════════════════════════════════════════════════

  // 只支持三种写法：标量 `k: v`、inline 数组 `[a, b]`、空值。
  // 多行块（`- item`）/ 多行文本（`|` `>`）→ 显式报错，绝不静默返回空对象。
  function unquote(s) {
    s = String(s == null ? '' : s).trim();
    if (s.length >= 2) {
      var a = s.charAt(0), b = s.charAt(s.length - 1);
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
    }
    return s;
  }

  function parseFrontmatter(text) {
    var raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (raw.slice(0, 4) !== '---\n') {
      return { hasFm: false, fm: {}, body: raw, error: null };
    }
    var lines = raw.split('\n');
    var end = -1;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end < 0) return { hasFm: false, fm: {}, body: raw, error: '没有 frontmatter 结束行' };
    var fmLines = lines.slice(1, end);
    var body = lines.slice(end + 1).join('\n');
    var fm = {};
    for (var j = 0; j < fmLines.length; j++) {
      var ln = fmLines[j];
      if (!ln.trim()) continue;
      var m = /^([^:\s][^:]*):\s*(.*)$/.exec(ln);
      if (!m) return { hasFm: true, fm: fm, body: body, error: '第 ' + (j + 2) + ' 行不是 key: value' };
      var k = m[1].trim(), v = m[2].trim();
      if (/^[|>][-+]?$/.test(v)) {
        return { hasFm: true, fm: fm, body: body, error: '第 ' + (j + 2) + ' 行是多行文本（' + v + '），不支持' };
      }
      if (v === '' && j + 1 < fmLines.length && /^\s+-\s/.test(fmLines[j + 1])) {
        return { hasFm: true, fm: fm, body: body, error: '第 ' + (j + 2) + ' 行是多行列表，不支持' };
      }
      if (v.charAt(0) === '[' && v.charAt(v.length - 1) === ']') {
        var inner = v.slice(1, -1).trim();
        fm[k] = inner ? inner.split(',').map(function (x) { return unquote(x); }) : [];
      } else {
        // 未加引号的标量里，空格+# 之后按注释处理（规范要求含 # 的值必须加引号）
        if (v.charAt(0) !== '"' && v.charAt(0) !== "'") v = v.replace(/\s+#.*$/, '');
        fm[k] = unquote(v);
      }
    }
    return { hasFm: true, fm: fm, body: body, error: null };
  }

  var BOARD_OF = {
    '01收件箱': 'inbox', '02原始资料': 'source', '03体验笔记': 'note',
    '04主题索引': 'index', '05我的输出': 'output', '06系统配置': 'config'
  };

  function noteTag(n, prefix) {
    var ts = (n && n.tags) || [];
    for (var i = 0; i < ts.length; i++) {
      var t = String(ts[i] || '');
      if (t.indexOf(prefix) === 0) return t.slice(prefix.length) || '未分';
    }
    return '';
  }

  // notes 每条：{ key, path, folder, board, title, tags, status, src_id, score, untracked, fmError, noFm }
  // 树形：收件箱(status=raw) / 领域(tag 主题/*)→类型(tag 类型/*) / 来源(02) / 归档
  function buildVaultTree(notes) {
    var inbox = [], sources = [], archived = [], main = [];
    (notes || []).forEach(function (n) {
      if (!n) return;
      if (n.folder === '06系统配置') return;                 // 06 不进树（另给「规范」入口）
      if (n.status === 'archived') { archived.push(n); return; }
      if (n.board === 'inbox') {
        if (n.status === 'note') main.push(n); else inbox.push(n);
        return;
      }
      if (n.board === 'source' || n.folder === '02原始资料') { main.push(n); return; }
      if (n.status === 'note') { main.push(n); return; }
      sources.push(n);                                        // 其余不吞掉，归来源
    });

    var domMap = {};
    main.forEach(function (n) {
      var dom = noteTag(n, '主题/') || '未分领域';
      var typ = noteTag(n, '类型/') || (n.board === 'source' ? '原文' : (n.status === 'note' ? '笔记' : '未分类型'));
      if (!domMap[dom]) domMap[dom] = {};
      if (!domMap[dom][typ]) domMap[dom][typ] = [];
      domMap[dom][typ].push(n);
    });
    var domains = Object.keys(domMap).map(function (dom) {
      var types = Object.keys(domMap[dom]).map(function (typ) {
        return { name: typ, notes: domMap[dom][typ] };
      });
      types.sort(function (a, b) {
        if (b.notes.length !== a.notes.length) return b.notes.length - a.notes.length;
        return a.name.localeCompare(b.name);
      });
      return { name: dom, types: types, nNotes: types.reduce(function (a, t) { return a + t.notes.length; }, 0) };
    });
    domains.sort(function (a, b) {
      if (b.nNotes !== a.nNotes) return b.nNotes - a.nNotes;
      return a.name.localeCompare(b.name);
    });

    var counts = { total: 0, note: 0, raw: 0, unknown: 0, untracked: 0, fmError: 0 };
    (notes || []).forEach(function (n) {
      if (!n || n.folder === '06系统配置') return;   // 06 不计入树统计
      counts.total++;
      if (n.status === 'note') counts.note++;
      else if (n.status === 'raw') counts.raw++;
      else counts.unknown++;
      if (n.untracked) counts.untracked++;
      if (n.fmError) counts.fmError++;
    });

    return { inbox: inbox, domains: domains, sources: sources, archived: archived, counts: counts };
  }

  // vault 名 + vault 内相对路径 → obsidian:// URI（只编码一次，防 %2520）
  function obsidianUri(vault, rel) {
    var f = String(rel == null ? '' : rel).replace(/\.md$/i, '');
    return 'obsidian://open?vault=' + encodeURIComponent(String(vault || '')) + '&file=' + encodeURIComponent(f);
  }

  return {
    parseAnchor: parseAnchor,
    absSource: absSource,
    countCards: countCards,
    buildTree: buildTree,
    sliceAnchor: sliceAnchor,
    parseFrontmatter: parseFrontmatter,
    buildVaultTree: buildVaultTree,
    obsidianUri: obsidianUri,
    BOARD_OF: BOARD_OF
  };
});
