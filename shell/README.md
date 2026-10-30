# 工作台（壳 + 方法库 + 复盘）

一个让 AI 协作「**沉淀方法论、复用经验、记坑不重踩**」的可视化工作台。
基于 Electron（也可作为 WorkBuddy 插件），把散落的方法论与复盘变成人和 AI 共读、可跳转的面板。

---

## 一、这是什么（三个组件）

| 组件 | 是什么 | 形态 |
|---|---|---|
| **壳** `luanyujia-shell` | Electron 应用 / WorkBuddy 插件。提供场景网格（含方法库、复盘）、顶栏、文件预览，并实现复盘 ↔ 方法库双向跳转 | 代码 |
| **方法库（知识库）** | 按「方法 / 自动化 / 素材 / 文档」分组的 Markdown 方法集，人和 AI 读同一批 `.md` | 纯文本文件夹 |
| **复盘** | 错题册式界面，记录踩坑与验证，可与方法库双向跳转 | 界面 + 模板 |
| **图书馆**（可选） | 直读 Obsidian vault：左栏知识树（收件箱 → 领域 → 类型 → 笔记 / 来源 / 归档），中栏 frontmatter + 正文前 40 行预览 + 跳转 Obsidian，右栏只做复习入口 | 界面（只读 md） |

**核心设计**：方法内容全在 `.md`，壳只负责展示与跳转，不承载方法论——所以方法库能被**任何 AI 直接复用**，不绑定某个特定 AI。

---

## 二、环境依赖

- **Node 18+**（含 npm）
- **DSH 引擎**：壳默认界面即其对话页，需自备 token（见配置）。DSH 是运行平台依赖，不是个人凭证。
- **不需要** Python、**不需要**任何个人账号。

---

## 三、安装与启动

```powershell
cd luanyujia-shell
npm install          # 首次会下载 Electron（约 100 MB，慢就换镜像）
npm start            # 或：npx electron .
```

自检（截图到 `selftest.png` 后退出）：

```powershell
npm run selftest
```

> 没装 Node？先装 Node 18+。⛔ 不要用别人的 `node_modules` 直接拷，版本不一致会白屏。

---

## 四、默认界面 = DSH 引擎对话页

启动后默认是引擎对话界面。引擎需要 token（`dsh web` 启动时会打印 `http://127.0.0.1:3080/?token=xxxx`）：

1. 把地址填进 `config.json` 的 `engineUrl`，token 填 `engineToken`；
2. 或在 `config.local.json` 里写（**本机配置，不进库**，已在 .gitignore）；
3. 引擎重启后 token 会变，重填一次即可。

没填 token 会看到「引擎没启动/地址不对」提示（401），不是程序坏了。点「工作台」页签回到场景网格。

---

## 五、配置（数据目录 + 轻路由）

- **数据目录**：在 `config.json` 里填 `methodLibraryRoot` / `selfReviewRoot`，指向你自己的「方法库」「复盘」目录（绝对路径，或相对本插件目录的相对路径）。`boot.cjs` 与 `main.js` 会据此自动解析，无需改 `scenarios/*.json`。
- **图书馆场景**（可选）：把 `libraryRoot` 填成你的 Obsidian vault 目录。场景直接读 vault 里的 `.md`（递归限 4 层、最多 3000 个节点、自动跳过 `.obsidian` 等点目录），**不派生索引、不写 vault、不要求 Obsidian 开着**；点「在 Obsidian 打开」用 `obsidian://` 深链跳转。不填 `libraryRoot` 时该场景会明确提示"未配置"，不会白屏。
- **学习工作区**（可选）：`learnRoot` 指向课页与进度目录；不填则用插件目录下的 `学习/`。
- **快捷启动**：`apps.mubu` / `apps.workbuddy` 填可执行文件绝对路径；不填则顶栏对应按钮自动隐藏（不留"点了必然报错"的按钮）。
- **DSH 引擎命令**：若 `dsh` 不在 PATH，在 `config.json` 填 `dshCmd` 绝对路径。
- **密钥**：`DEEPSEEK_API_KEY` 走环境变量注入（启动前 `set DEEPSEEK_API_KEY=sk-...`），不要写进任何仓库文件。
- **轻路由 skill** `workbench-route-progress`：在技能页开启，负责开局读索引 + 收尾写进度。

---

## 六、使用

- **方法库**：往对应子目录（`方法/` `自动化/` `素材/`）放 `.md`，frontmatter 写 `name` / `triggers` / `when-not` / `回流自`，面板自动按类型分组、可折叠。
- **复盘**：在错题册按 h4 格式记坑（`#### 名称｜C-00X｜复发 N｜状态：…`），可标记「→库」回流到方法库。
- **双向跳转**：复盘条目跳方法库对应条目；方法库条目的「回流自 C-00X」跳回复盘原条目（仅一层，防连环跳）。

---

## 七、目录结构

```
luanyujia-shell/
├── main.js            主进程：窗口、IPC（读文件/列目录/盘容量）
├── preload.js         只暴露必要能力（contextIsolation 开着）
├── boot.cjs           启动脚本（DSH 命令可配置；不含任何个人依赖）
├── package.json       启动脚本 + Electron 依赖
├── renderer/
│   ├── index.html     顶栏 + 场景条 + 网格
│   ├── app.js         读 scenarios/*.json、渲染面板、方法库分组、JumpBus 跳转
│   ├── lib-model.js   图书馆纯逻辑层（frontmatter 解析 / vault 建树 / obsidian:// 生成，可被 node 直接 require 自测）
│   └── style.css      深色/浅色
├── scenarios/         场景配置（method-library 方法库 / self-review 复盘 / library 图书馆）
└── config.local.json  本机私密配置（token / 真实目录），不进库
```

> 方法库与复盘的具体 `.md` 由你自己填充；仓库提供**空模板 / 种子示例**，不含任何原作者私人数据。

---

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `npm start` 报 Electron 下载失败 | 换镜像：`npm config set registry https://registry.npmmirror.com` 后重走 |
| 窗口白屏 | 先 `npm run selftest` 看截图；再看主进程日志 |
| 文件面板显示 `C:\` 或方法库空 | `config.json` 的 `methodLibraryRoot` 没配或路径不对 —— 填你的真实目录 |
| AI 面板白字占位 | 正常：接法见第四节（填 DSH token） |
| 想改品牌名 | `renderer/index.html` 里 `.brand` 文本 |

---

## 九、许可

[MIT] —— 作者：1967-ziqian（luanyujia）

欢迎提 Issue / PR。
