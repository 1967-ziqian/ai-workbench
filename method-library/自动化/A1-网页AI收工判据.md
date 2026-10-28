---
name: auto.a1-settlement-judgment
title: A1 网页 AI 收工判据
type: automation
description: 抓网页 AI 多轮流式回答时，判断回答是否已稳定收工，避免过早（交半句）或过晚（白等）。统一按真实秒数判，不按轮数。
triggers:
  - 用脚本抓取 DeepSeek/豆包/千问/智谱/Kimi 的多轮流式回答
  - 需要自动判定「可以收工了」的时机
when-not:
  - 单次同步 API 调用（本就有完整返回，无需判据）
source: 工程师功能（webai_ask.py 的 settle_update）
回流自: C-002
最后核对: 2026-10-28
---

# A1 网页 AI 收工判据

## 这条为什么存在
旧口径「连续 N 轮长度不变」有两个洞：① 慢速每轮涨 3 字也被判稳定，连 3 轮就交出半句；② 门槛写的是轮数，而一轮耗时随站点数漂移（单站 0.6s / 五站 3s），同一个「3 轮」在不同场景下时长完全不同。统一改走**按秒的 settle_update**。

## 入口命令
```bash
python tools/test_webai_settle.py     # 回归自证
```
（`settle_update` 是 `webai_ask.py` 内的纯函数，主循环与收尾都走它，不另写一套。）

## 输入
- `series`：每轮采到的「内容 + 时间戳」序列。
- `dt`：距首次出现内容的秒数。

## 输出
- `settled = True/False` + 稳定秒数。

## 退出码含义
- `test_webai_settle.py`：全部断言通过 → `EXIT=0`；任一断言失败 → `EXIT=1`。

## 步骤
1. 每轮记录内容与时间戳，形成长度序列。
2. 收工条件（**全部满足**才算收工）：
   - 长度**完全**未变（涨 1 字也算「还在长」）；
   - 稳定持续 ≥ 5~6 秒；
   - 从首次出现内容起 ≥ 8 秒（短答案）/ 12 秒（长答案）。
3. 超时兜底：取最后一块新增内容，但**不把「还在生成」误判成收工**——只认「停止生成」类按钮文案，不靠 `cursor / typing` 之类的 class 猜（Tailwind 的 `cursor-pointer` 常驻页面，会把每站都判成还在跑）。
4. 后台窗口读文本：先 `innerText`，返回空再退 `textContent`（后台 `visibility:hidden` 时 innerText 恒空）。
5. 只取**最后一块新增内容**：豆包会把「上一轮答案 + 追问建议」重新渲染，指纹一变就算新块，拼多块＝把上轮答案带回来。

## 验收
`python tools/test_webai_settle.py` 全绿，19 条断言，其中含「旧口径必须提前收工」的**鉴别力反证**（防止有人改回旧口径而不自知）。

## 参考实现（本地）
- `webai_ask.py` 的 `settle_update(series, dt)`：纯函数。
- `tools/test_webai_settle.py`：回归测试。
