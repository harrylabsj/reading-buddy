# 命令参考

所有命令：`node scripts/reading-buddy.mjs <命令> [选项] [--mode live|demo]`

stdout 始终为 JSON；失败时 stderr 输出 `{"ok":false,"error":{"code":…,"message":…}}`。
退出码：0 成功 · 2 参数/数据校验 · 3 缺少或失效授权 · 4 记录不存在 · 5 请求过于频繁 · 1 其他错误。

## 状态与同步

- `status` — 凭证状态（是否配置、来源、账户指纹，永不显示 Key）、同步状态、快照摘要、目标设置、卡片/回顾数量。离线可用。
- `sync` — 联网同步书架、周/月统计、最近 100 本笔记概览、12 本书详情与最多 2 本书的笔记；**等待完成后退出**。返回 `warnings`（部分失败保持显式）。无凭证时退出码 3。`--mode demo` 直接返回无需同步。

## 查询（离线可用）

- `books [--query t] [--status all|reading|finished] [--offset n] [--limit n]`（limit ≤30）— 分页搜索已同步电子书；`total` 为筛选后总数，不含有声书/文章收藏。无快照时返回空列表与提示，不报错。
- `notes <bookId> [--refresh] [--offset n] [--limit n]` — 某本书的已载入笔记；`--refresh` 需联网逐页更新（上限 50 页，超出会在数据中留下部分载入提示）。输出含 `totalLoaded`、`nextOffset` 与“已载入部分”说明。

## 偏好与整理

- `settings` / `settings set --goal n --timezone Asia/Shanghai --primary-book <id|null>` — 每日目标（分钟）、时区、主读书；主读书必须在当前书架中。修改时区会标记周/月统计需重新同步。
- `reflect --note-id <id> --text <text>` — 为一条笔记保存个人回顾；长文本用 `--text-file <文件>` 或 `--input <json文件>`（`{"noteId":"…","text":"…"}`）。
- `draft --notes <id,id…> [--reflection t]` — 由选定笔记（≤20 条）生成本机卡片草稿，保留来源，不伪造个人感悟；长反思用 `--reflection-file <文件>`。
- `review --period weekly|monthly` — 复盘草稿；缺失数据保持空白，不补造。
- `save-card --title t --body b [--kind card|weekly|monthly] [--note-ids id,id] [--id 既有卡片]` — 保存本机卡片/复盘（更新同 id 卡片），仅用户明确要求后使用；正文含特殊字符时用 `--body-file <文件>` 或 `--input <json文件>`。

无效输入一律以退出码 2 明确失败：`--mode` 不是 live/demo、未知 `--flag`、`--status`/`--kind`/`--period` 非法、分页参数不是范围内整数、`settings` 子命令不是 set。

## 备份与报告

- `backup export <路径>` — 导出本机数据（0600 私有权限），不含凭证。
- `backup import <路径>` — 校验备份（个人/示例数据不可混导）、导入前自动保存恢复副本、按更新时间与 id 去重合并。
- `report <输出.html>` — 自包含只读 HTML 报告（今日/书架/笔记/复盘四区，0600 权限），不含凭证；页内交互只影响显示。

## 凭证

- `auth status` — 是否已配置、来源（环境变量 / 本机凭证文件）、凭证文件路径、账户指纹。
- `auth import <文件>` — 从用户指定的本机文件读取 Key（一行，不写进命令参数），校验格式后以 0600 存入用户级配置目录。
- `auth revoke` — 删除本机凭证文件；若 Key 来自环境变量则提示需另行移除。
