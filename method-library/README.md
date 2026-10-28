# 方法库（method-library）

跨 AI 可复用的解题方法论，纯 `.md` 源文件。任何 AI 读 `AGENTS.md` 即自举会用——这是「不绑定某个 AI」的核心：方法内容在此，壳只负责展示。

## 结构

- `_INDEX.md` 索引（triggers / when-not，开局路由用）
- `身份.md` / `设计框架.md` / `AGENTS.md` / `GLOSSARY.md` / `进度.md` 五块框架说明
- `方法/` `自动化/` `素材/` 内容分组

## 怎么用

1. 让 AI 读 `AGENTS.md`，按「发现 → 判命中 → 套用 → 留痕」四步；
2. 接任务先查 `_INDEX.md` 按 triggers 匹配，命中才点开对应 `.md`；
3. 条目 frontmatter 写 `name` / `triggers` / `when-not` / `回流自`（中文 key 也支持）；
4. `回流自 C-00X` 与复盘双向跳转（见 `../self-review/`）。

> 路径约定：本库内引用用相对路径；与方法库、复盘同仓库，互为 `../` 关系。
