---
name: reading-buddy
display_name: 读书搭子
description: 在用户电脑本地查看微信读书书架、阅读统计与笔记，整理并保存私人读书卡片与阅读复盘；免连接器、免 MCP 服务器、不依赖云端业务服务。
description_zh: 在用户电脑本地查看微信读书书架、阅读统计与笔记，整理并保存私人读书卡片与阅读复盘；免连接器、免 MCP 服务器、不依赖云端业务服务。
description_en: Reads a user's WeRead shelf, reading stats and notes locally, and saves private reading cards and reviews — no connector, no MCP server, no business cloud service.
version: 0.3.0
author: 北京海纳福星文化传媒有限公司
allowed-tools: Bash
---

# 读书搭子（免连接器 Skill）

在用户本机读取微信读书数据并整理成读书卡片与复盘。脚本通过 WorkBuddy 的本地 Bash 工具权限执行，需要用户电脑装有 Node.js 20 或更新版本；**普通 Skill 不会自动获得连接器的托管 Node 运行时**，请确认本机 `node --version` 可用。

- 数据只保存在用户本机，按凭证隔离；备份与报告不含任何凭证。
- 同步、保存等数据更新是显式的脚本任务；本 Skill 不内置网页界面，报告是只读快照。
- 不要向用户索取、复述或输出 `WEREAD_API_KEY` 或任何凭证内容。

## 一次性本地配置（仅一次）

WorkBuddy Skill 没有连接器的凭证表单。首次使用前，让用户在本机完成一次配置（不要把 Key 发到聊天里）：

1. 用户用系统文本编辑器把微信读书 API Key 单独保存为一个本机文件，例如 `~/weread-key.txt`（内容只有一行 `wrk-…`）。
2. 通过 Bash 执行（以本 Skill 包目录为工作目录）：
   `node scripts/reading-buddy.mjs auth import ~/weread-key.txt`
3. 导入成功后删除原始文件即可；凭证以 0600 权限保存在用户级配置目录，也可用 `auth revoke` 移除。
4. 若用户更熟悉环境变量，也可以直接设置 `WEREAD_API_KEY`，脚本会优先使用环境变量。

配置状态随时可用 `node scripts/reading-buddy.mjs auth status` 查看（只显示是否已配置与来源，永不显示 Key 本身）。

## 使用方式

所有命令输出确定性 JSON；错误写入 stderr 并带有退出码（0 成功、2 参数/校验、3 缺少授权、4 不存在、5 请求频繁、1 其他）。默认操作个人数据（live），加 `--mode demo` 使用独立的虚构示例数据。

常用任务示例（以 Skill 包目录为工作目录，通过 Bash 执行）：

- “我现在读得怎么样”：`node scripts/reading-buddy.mjs status`
- “同步一下我的微信读书”：`node scripts/reading-buddy.mjs sync`（等待完成，不会后台悬挂）
- “我该继续读什么”：`node scripts/reading-buddy.mjs books --status reading --limit 5`
- “整理这本书的笔记”：先 `books --query 书名` 找到 id，再 `node scripts/reading-buddy.mjs notes <bookId> --refresh`（按需联网），然后见下一条
- “用选中的笔记生成读书卡片”：`node scripts/reading-buddy.mjs draft --notes <id,id> --reflection "用户的补充理解"`，展示草稿；用户确认后保存（见下一条）。反思内容较长时用 `--reflection-file <本机文件>` 从文件读取。
- “复盘本周/本月阅读”：`node scripts/reading-buddy.mjs review --period weekly`（或 monthly），确认后同上保存，`--kind weekly|monthly`
- “保存已确认的卡片/复盘”：`node scripts/reading-buddy.mjs save-card --title "标题" --body "内容"`；内容含引号、反引号、美元符或换行时，改用 `--body-file <本机文件>` 或 `--input <json文件>`（如 `{"title":"…","body":"…"}`），避免 shell 转义；`reflect --note-id <id>` 同理支持 `--text-file` / `--input`
- “生成一份本机阅读报告”：`node scripts/reading-buddy.mjs report ~/reading-report.html`，在浏览器打开；页内搜索/筛选/切换只影响显示，不修改数据；示例数据报告完全内嵌（打开时不产生外部网络请求），个人报告的微信读书封面会在浏览时从其图片域名加载

无效选项（如 `--mode typo`、未知 flag、非数字分页、`--status`/`--kind` 非法值、错误的 settings 子命令）会明确报错并以退出码 2 失败，不会静默降级。

详细命令与选项见 [references/commands.md](references/commands.md)；凭证与数据安全说明见 [references/security.md](references/security.md)。

## 行为边界

- `notes` 返回的是**已载入部分**，未完整载入时必须说明；时长缺失显示“暂不可用”，不补 0。
- 区分原文、用户想法与 AI 建议；用户未提供个人理解时只生成摘录整理，不伪造感悟。
- 只保存用户明确确认后的卡片/复盘（`save-card` 为显式写操作）；不向微信读书发布、评论或分享。
- 只有用户选中并明确要求的笔记内容才进入 WorkBuddy 模型任务；不要主动把整库笔记发给模型。
