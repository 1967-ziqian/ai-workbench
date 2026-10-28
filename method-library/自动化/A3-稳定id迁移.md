---
name: auto.a3-stable-id-migration
title: A3 稳定 id 迁移
type: automation
description: 给册子条目加稳定 id（C-001…），条目名当主键不稳——改一次名要同步册子/使用记录/索引/IMA 四处。id 写在 h4 第二段，迁移幂等。
triggers:
  - 册子条目需要稳定主键
  - 改名频繁导致索引/使用记录/IMA 失配
when-not:
  - 条目极少、改名不会发生
source: 工程师功能（tools/book_ids.py）
最后核对: 2026-10-28
---

# A3 稳定 id 迁移

## 这条为什么存在
条目名会改，id 不会。用稳定 id 当主键，改名只需改显示名，四处解析点自动跟随。

## 入口命令
```bash
python tools/book_ids.py --dry     # 只看会改什么，不动文件
python tools/book_ids.py --check   # 检查是否已全部带 id
python tools/book_ids.py           # 执行迁移（幂等）
```

## 输入
- 复盘册子的 h4 条目行。
- 已有 id 情况（用于幂等判断）。

## 输出
- 带 id 的册子 + 迁移日志（改了哪些条目、原来叫什么）。

## 退出码含义
- 无显式退出码，成功返回 0。

## 步骤
1. **先备份**册子，再迁移。
2. 在 h4 **第二段**写入 `C-XXX`：
   ```
   #### 名称｜C-001｜复发 N｜状态：…｜提醒 X · 还犯 Y · 漏提醒 L
   ```
   放第二段是因为渲染层取 `｜` 切分后的**第一段**当显示名——放第一段界面会变成「C-001」。
3. 幂等迁移：已带 id 的跳过；未带的补。
4. 同步解析点（**都用 id，不用名**）：
   - `tools/book_state.py`（H4 正则 + 回写）——旧正则 `.+?` 非贪婪会吞掉 `｜C-001` 整段，导致统计查不到、状态被误刷成「提醒不足」；
   - `tools/recheck.py`（写复查记录带 id）；
   - `tools/_ima_push_all.py` / `_ima_push_one.py`（笔记标题带 id）；
   - `renderer/app.js` 的 `parseBookMap`（容忍多一段，不用改）。

## 验收
- 迁移后再跑一次 → 无改动（幂等）。
- **改 h4 格式必须实测正则**，别凭「应该能匹配」——`.+?` 吞段这类问题只有跑过才知道。

## 参考实现（本地）
- `tools/book_ids.py`：`--dry` / `--check`，幂等。
