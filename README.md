# AI 工作台（ai-workbench）

辅助 AI 协作的**可成长知识系统**：把"方法论"沉淀成可复用、可联动的知识资产，让任何 AI 都能读、能套、能进化。

> 仓库初始名 `ai-`（GitHub 自动 slug），建议在仓库 Settings → Repository name 改为 `ai-workbench`。

## 三大组件

| 组件 | 目录 | 作用 |
|---|---|---|
| **壳（插件）** | `shell/` | WorkBuddy 插件，把方法库 / 复盘渲染成可视化面板，支持分组折叠、双向跳转 |
| **方法库** | `method-library/` | 跨 AI 可复用的解题方法论（`.md` 源文件），含目录 / 守则 / 身份 / 进度四块 |
| **复盘** | `self-review/` | 错题与措施台账模板，与方法库双向联动（→库 / 回流自） |
| **轻路由 skill** | `skills/workbench-route-progress/` | 让 AI 每轮开局读方法库索引、结束强制写进度（防重复劳动） |

## 特性

- **跨 AI 复用**：方法库是纯 `.md`，任何 AI 读 `AGENTS.md` 即自举会用
- **双向联动**：复盘条目可一键跳到方法库对应方法，方法可标记"回流自"复盘
- **强制纪律**：轻路由 skill 把"读索引 + 写进度"变成硬触发，杜绝"做过又重做"

## 环境依赖

- [WorkBuddy](https://www.workbuddy.cn)（壳是 WB 插件）
- DSH 引擎（壳默认界面，需自备 token）

## 安装与使用（待壳路径配置化后完善）

1. 用 WorkBuddy 打开本仓库的 `shell/` 作为插件
2. 在配置里指定你自己的「方法库目录」和「复盘目录」
3. 启用 `workbench-route-progress` skill
4. 详细见各组件目录的 README

## 许可

[MIT](LICENSE) — Copyright (c) 2026 1967-ziqian
