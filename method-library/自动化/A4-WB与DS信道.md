---
name: auto.a4-wb-ds-channel
title: A4 WB 与 DS 互通信道
type: automation
description: 通过 DSH 引擎 RPC 桥在 WorkBuddy 与 DeepSeek 会话之间收发消息，无需人工中转。WB 写正文→发到固定会话；DS 回信→从会话落盘读出。
triggers:
  - 需要让 DS 审稿、挑刺、做多轮协作
  - 需要读取 DS 在指定会话里的最新回信
when-not:
  - 纯本地思考，不需要 DS 参与
  - DSH 引擎未运行或未授权
source: 工程师功能（tools/ds_send.py、tools/ds_read.py、dsh_rpc.py）
最后核对: 2026-10-28
---

# A4 WB 与 DS 互通信道

## 这条为什么存在
WorkBuddy（WB）和 DeepSeek（DS，跑在 DSH 桌面端）之间需要一条稳定的文字收发通道：WB 能直接甩问题给 DS，也能把回信读回来，不靠人工复制粘贴。

## 入口命令
```bash
python tools/ds_send.py            # 读 tools/to_ds.txt 发出去
python tools/ds_send.py --dry      # 只做检查，不发送
python tools/ds_read.py            # 导出 DS 最新一条回信
python tools/ds_read.py --diff     # 同时报告与上次导出是否相同
```

## 输入
- 发送：正文文件 `tools/to_ds.txt`。
- 读取：DSH 会话落盘 `C:\Users\Administrator\.dsh\sessions\...\session.v4.jsonl.zstd`。

## 输出
- 发送：`status = 200`，返回体含 `accepted: true`。
- 读取：`tools/ds_reply.txt`（DS 最新一条回信全文，长段按句号切，防工具读取截断）。

## 退出码含义
- `ds_send.py`：正文为空 → `EXIT=1`；`--dry` → `EXIT=0`（不真发）；正常发送无显式退出码，返回 0。
- `ds_read.py`：找不到会话落盘 / 没有 assistant/message → `EXIT=1`；正常导出返回 0。

## 步骤
### 发送（WB→DS）
1. 把正文写进 `tools/to_ds.txt`（避开 bash 引号/反引号被吃掉）。
2. 跑 `ds_send.py`：读该文件 → `dsh_rpc.send` 发到固定会话 `session-e82cda0f-7fc8-4a4d-837b-eeb95503500c`。
3. **发送端强制补方向标记**：首行若不是 `WB→DS` / `DS→WB`，自动加 `WB→DS`——靠发送端补齐才是**可验证的硬约束**，不是写进约定靠人记。

### 读取（DS→WB）
1. 发完等 DS 在会话里异步生成回信（通常几十秒）。
2. 跑 `ds_read.py`：解压会话落盘 → 取最新一条 `assistant/message` → 写 `ds_reply.txt`。
3. `--diff` 比对与上次导出，无变化即"没有新回复"。

## 验收
- 发送返回 `status = 200` 且 `accepted: true`。
- 读回的回信首行是 `DS→WB`（方向标记成对）。
- **回信必须真的读到**才算交流完成：发完不读 = 只说没听。

## 参考实现（本地）
- `tools/ds_send.py`、`tools/ds_read.py`。
- `dsh_rpc.py`：ACP over HTTP 桥，`POST http://127.0.0.1:3080/api/<method>`，token 取 `plugins/luanyujia-shell/config.local.json` 的 `engineToken`，提供 `send / list / create / cancel`。

## 其他 AI 复用须知
依赖本机 DSH 引擎与已授权会话，**没有 DSH 环境跑不了**。这条文档写进库是为了让别的 AI 知道「WB 和 DS 怎么对话、脚本在哪」；脚本本身属 DSH 本地能力，不外传。
