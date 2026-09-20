# 凭证与数据安全

## 凭证不落聊天、不落命令参数

- 唯一支持的输入方式：本机文件 + `auth import <文件>`，或用户自行设置 `WEREAD_API_KEY` 环境变量。
- 解析顺序：环境变量优先，其次本机凭证文件（`credentials.json`，0600）。
- `auth status` 只显示“是否配置 / 来源 / 账户指纹（SHA-256 前 20 位十六进制）”，永不显示 Key 原文。
- 凭证文件损坏或格式不对时，`auth status` 的 `storeProblem` 与相关报错会明确说明（绝不回显文件内容），重新 `auth import` 即可修复。
- **可安全分享的是凭证相关输出**：任何命令的 stdout / stderr、备份、HTML 报告、Skill 包都不含凭证或 Key 指纹之外的凭证内容，排查授权问题时可以安全分享 `auth` 命令与报错的输出。
- **注意区分**：笔记、读书卡片、HTML 报告与备份包含你的个人阅读内容（书名、划线、想法、阅读时长）。这些输出不含凭证，但仍属隐私内容，只在有意分享时才发给他人或模型任务。
- `backup export` 与 `report` 拒绝覆盖凭证文件或当前模式的激活数据文件；输出文件一律 0600。

## 数据位置与隔离

- Skill 模式默认数据目录：Linux `~/.local/share/ReadingBuddy`，macOS `~/Library/Application Support/ReadingBuddy`，Windows `%LOCALAPPDATA%\ReadingBuddy`。
- 凭证目录：Linux `~/.config/ReadingBuddy`、Windows `%APPDATA%\ReadingBuddy`；**macOS 上配置目录与数据目录默认同为 `~/Library/Application Support/ReadingBuddy`**（数据存于 `profile-*.json` / `demo.json`，凭证单独存于同目录的 `credentials.json`，0600；并非两个独立目录）。
- 数据与凭证目录可用 `READING_DATA_DIR` / `READING_CONFIG_DIR` 覆盖（测试与高级用户）。
- 同一凭证 → 同一账户数据空间（按凭证哈希分文件）；无凭证 → 空数据，绝不落入他人数据。
- `demo` 模式是完全独立的虚构数据（`demo.json`），与个人数据互不混用，备份导入也会校验模式。
- 个人/示例数据文件与报告/备份均使用 0600 私有权限写入。

## 同步的边界

- `sync` 等待完成才退出；失败时保留上次成功数据并在 `warnings` 中逐条说明。
- 首次同步：书架 + 周/月统计 + 最近 100 本笔记概览 + 12 本书详情 + 最多 2 本书的笔记；其余笔记用 `notes <bookId> --refresh` 按书补齐（单次上限 50 页，超出会标注“部分想法尚未载入”）。
- 阅读总时长以接口 `totalReadTime` 为准；缺失值显示“暂不可用”，不填 0。

## 已知限制

- 普通 Skill 通过 WorkBuddy 本地 Bash 工具权限执行脚本，**不自动获得连接器托管的 Node 运行时**；需要用户本机已安装 Node.js 20+。
- 文档未提供 Skill 内嵌 GUI 直接写数据的宿主桥接；看板式完整界面仍属连接器/MCP 路径。本路径的数据更新均为显式命令。
- 示例数据（`--mode demo`）是完全独立的虚构数据，不会显示或泄露任何个人授权信息、账户指纹或真实数据。
- 示例数据的 HTML 报告插图与封面完全内嵌，打开时不产生外部网络请求；个人报告的微信读书封面图会在浏览时从其图片域名加载。
- 移除连接器不会移除 Buddy 应用注册时填写的 scope / OAuth 字段；如曾创建过带这些字段的注册，需要平台侧另行处理。
