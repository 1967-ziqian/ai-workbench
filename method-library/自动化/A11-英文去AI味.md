---
name: auto.a11-humanizer
title: A11 英文去AI味（humanizer）
type: automation
description: 识别并移除英文文本的 AI 写作痕迹，同时注入人味（观点/节奏/复杂性/第一人称）。基于 Wikipedia Signs of AI writing。英文文本编辑/润色要去AI味时触发。
triggers:
  - 英文文本需要去 AI 味 / 更自然 / 更像人写
  - 触发词：humanize、去AI味(英文)、make it natural、remove AI patterns
when-not:
  - 纯技术文档需保留中性客观（低人味）
  - 正式学术论文要严谨（低人味，不注入个人观点）
source: 现有 skill（~/.workbuddy/skills/humanizer）
性质: 方法型自动化步骤（24 类痕迹识别 + 改写流程）
最后核对: 2026-10-28
---

# A11 英文去AI味（humanizer）

## 核心原则
避免 AI 痕迹只是半件事——**无菌无魂的写作和烂写一样明显**。好写作背后有人。流程：识别痕迹 → 改写 → 保留原意 → 匹配语气 → **注入人味**。

## 注入人味（比去痕迹更重要）
- **有观点**：别只列事实，对事实有反应（"我真不知道该什么感受"比中性罗列更人）。
- **变节奏**：短促句，再接慢慢铺开的长句，混着来。
- **承认复杂**：真人都有矛盾感受（"很惊艳但也挺不安" > "很惊艳"）。
- **该用 I 就用**：第一人称不是不专业，是诚实。
- **放点乱进来**：完美结构显算法感，跑题/插话/半成型的念头都是人。
- **感受要具体**：不是 "concerning"，是 "agents churning at 3am while nobody's watching"。

## 24 类痕迹（按类记，不必背词表）
- **内容类**：意义/遗产膨胀（testament/landscape/pivotal）、媒体吹捧（independent coverage/leading expert）、-ing 表面深度（highlighting/reflecting）、促销语（nestled/breathtaking/showcasing）、模糊归因（experts argue/some critics）、挑战展望模板（Challenges and Future Outlook）。
- **语言类**：高频 AI 词（additionally/delve/underscore/tapestry/intricacies）、系词回避（serves as/boasts→is/has）、反向排比（Not just…but…）、三段强迫、雅变（同义轮替）、伪范围（from X to Y 不在同一尺度）。
- **风格类**：em dash 滥用、机械加粗、标题大小写（Title Case）、emoji 装饰、弯引号“”。
- **沟通类**：协作客套（I hope this helps/let me know）、知识截止免责（as of my last update）、讨好卑屈（You're absolutely right）。
- **填充类**：废话（in order to→to / at this point in time→now）、过度 hedge（could potentially possibly be argued）、通用正能量结尾（Exciting times lie ahead）。

## 流程
1. 细读输入。2. 找出所有上述痕迹。3. 改写每段问题处。4. 确保改写后：朗读自然 / 句式自然变化 / 具体胜过模糊 / 语气合适 / 该用 is/are/has 就用。5. 输出：改写版 + 变更摘要（可选）。

## 参考实现（本地）
- `~/.workbuddy/skills/humanizer/SKILL.md`：完整版（含逐类 Before/After 对照、Full Example、Wikipedia 出处）。
- 与 `自动化/A10` 关系：A10 管中文、A11 管英文，同家族（都去AI味），互相不重复。
