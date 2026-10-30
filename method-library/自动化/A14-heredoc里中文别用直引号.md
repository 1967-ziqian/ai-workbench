---
name: auto.a14-no-ascii-quotes-in-heredoc
title: A14 往 heredoc / 代码里写中文正文时，别用直引号
type: automation
description: 用 `python - <<EOF` 改文件时，中文字符串里出现 ASCII 直引号（" 或 '）会当场把 Python 字符串截断，报 SyntaxError；改到一半的文件也不会落盘，看起来像"改失败了但没报错"。中文正文一律用「」『』。
triggers:
  - 用 heredoc 跑 python 脚本改 md/html/py 文件
  - 脚本里要写中文引号、书名号、或引用一段话
  - 报错 `SyntaxError: invalid syntax. Perhaps you forgot a comma?` 但看起来代码没毛病
when-not:
  - 改动内容是纯 ASCII（配置、JSON、英文注释）
  - 用 Edit/Write 工具直接改（不经 heredoc，没有这层转义）
source: 本会话实测三次（2026-10-29，改 audit_due.py / 00-规格.md 时连续踩）
最后核对: 2026-10-29
---

# A14 往 heredoc / 代码里写中文正文时，别用直引号

## 这条为什么存在

2026-10-29 一节会话里踩了三次，每次表现都一样：

```
    print("该抽第 %s 门课……——记 degrade_reason=no_ai_hint，"
          "不许换成"随便抽一条"糊过去" % (...))
                                        ^
SyntaxError: invalid syntax. Perhaps you forgot a comma?
```

看着像"漏了逗号"，实际是那段中文里的 `"随便抽一条"` 用了 ASCII 直引号，
把外层的 `"..."` 提前闭合了。**中文字符不是问题，直引号才是问题**。

同一个坑换了三种场景出现：写 python 字符串、写 Markdown 正文、写规格里的判据条目。
Markdown 那份更隐蔽——它不会报错，只是把一段话写成了两截，读起来还通。

## 怎么做

1. **中文正文里的引号一律用「」『』**，不用 `"` `"` `'`。
2. 真要引号，用中文全角引号（U+201C/201D），它在 Python 字符串里不构成分隔符。
3. 改 Markdown / 规格这类长文，**优先用 Edit/Write 工具**，不要拼 heredoc。
4. 落盘前先 `ast.parse` 验一遍；改 md 就 `grep -c` 验关键行数变化。

## 为什么归 automation

它有明确的触发条件、明确的替代动作（换引号/换工具）、可机械自检（`ast.parse`）。
不依赖判断力，属于"照做就对"的那类。
