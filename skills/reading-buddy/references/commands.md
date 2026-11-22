# 命令参考

所有命令：`node scripts/reading-buddy.mjs <命令> [选项] [--mode live|demo]`。输出路径放在选项前；带空格路径用引号。除帮助外 stdout 为 JSON，失败 stderr 为 `{"ok":false,"error":{"code":…, "message":…, "retryAt":…}}`。退出码：0 成功、2 参数、3 授权、4 不存在、5 限流、1 其他错误。

## 状态、工作台和按需同步

- `doctor`：离线检查 Node.js、授权配置、快照、历史空间是否存在以及限流期限。`authorizationVerified:false` 表示配置检查未验证联网授权。
- `status`：离线快照概要、统计、偏好与卡片数量。
- `workspace [输出.html] [--sync] [--force] [--open]`：默认从缓存生成账户独立的工作台；`--sync` 表示用户要求联网更新基础数据，近期有效缓存会复用，`--force` 立即重新同步。`--open` 使用系统默认应用打开文件，失败时仍返回已生成路径；无个人数据时提示配置或同步，`--mode demo` 可独立体验。
- `report <输出.html> [--open]`：兼容已有报告生成命令，无联网同步。
- `sync [--scope basic|full] [--if-stale]`：等待完成后退出。默认 basic 只取书架、周/月统计及最近 100 本笔记目录，最多四个基础请求；full 额外补齐最多 12 本书详情与 2 本书正文。`--if-stale` 复用 15 分钟内、当前周期有效且无警告的缓存。并发任务和限流均按账户约束。
- `book <bookId> [--refresh]`：仅补齐该书信息和进度；15 分钟内复用详情，`--refresh` 强制刷新。
- `books [--query t] [--status all|reading|finished] [--offset n] [--limit n]`：离线分页，limit≤30；不把未知进度判为已读。
- `notes <bookId> [--list] [--note-ids id,id] [--refresh] [--restart] [--offset n] [--limit n]`：`--list` 仅返回 ID、标题、章节、日期和类型。默认正文为摘要，每字段≤800字符、单次正文≤12,000字符，不修改原文；`truncated` 标记摘要截断。`--note-ids` 限定用户选定笔记，最多20条。`--refresh` 联网按书更新，单次最多50页；不完整时保留旧笔记并保存断点，下次刷新继续，`--restart` 与 `--refresh` 同用，从首页重新核对。只有完整一轮结束后才核对移除旧记录。

## 整理与偏好

- `review --period weekly|monthly [--note-ids id,id]`：默认统计复盘和最多30条笔记目录，无正文。所选 ID 必须在本周期且已载入；指定 ID 时只返回这些正文摘要，最多20条。`availableNotes` 表示本期已载入数量。
- `draft --notes id,id [--reflection t|--reflection-file 文件]`：所选笔记的本机草稿；提供来源、用户理解、专家分析与下一步行动的结构。不会自行调用模型或伪造感悟。
- `save-card --title t --body b|--body-file 文件 [--kind card|weekly|monthly] [--note-ids id,id] [--id 既有卡片] [--origin local|workbuddy]`：保存用户已确认的内容；也可单用 `--input <json文件>`，字段为 `title,body,kind,noteIds,id,origin`。AI改写的成稿使用 `workbuddy` 来源，并标注 AI 整理。
- `reflect --note-id id --text t|--text-file 文件|--input 文件`：保存用户已确认的个人回顾，JSON字段为 `noteId,text`。
- `settings [set --goal 5..600 --timezone Asia/Shanghai --primary-book id|null]`：偏好、主读书；修改时区后统计需重新同步。

## 凭证与历史恢复

- `auth status`：仅显示本机配置、来源和账户指纹，不代表已验证联网授权。
- `auth import <用户指定文件>`：导入一行 Key 到0600私有凭证文件；环境变量优先，原始文件可由用户删除。
- `auth revoke`：移除凭证文件；环境变量仍有效时明确提示。
- `auth history`：列出当前空间之外的本机历史标识、数量和同步时间，无笔记/卡片正文；未授权的本机空间使用 `unconnected` 标识。
- `auth export-history <历史标识> <输出.json>`：导出指定旧空间到私有备份，保留旧文件。必须先由用户确认归属再调用；之后显式 `backup import <备份>` 恢复到当前空间，不自动合并其他账户。
- `backup export <路径>` / `backup import <路径>`：私有导出、校验与去重合并。live/demo不可混导，导入前保存恢复副本。报告/导出不可覆盖任何已有受管账户文件或凭证文件。

未知选项、错误布尔值、非法分页、错误同步范围和缺失参数均在相关操作开始前报错。`--force` 仅在 `workspace --sync` 下使用；`--restart` 仅在 `notes --refresh` 下使用。

## 公开读友发现

- `find-book <书名>`：联网搜索电子书（最多返回15条片段），没有个人书架也能使用；书名有歧义时让用户选书。
- `highlights <bookId>`：取得最多20条热门划线，包含 `chapterUid`、`range` 和原文片段；不包含读友列表。
- `readers <bookId> [--question 问题] [--chapter-uid n --range a-b] [--refresh]`：书级最多2段热门划线（各2页）及2页书评；段落级最多2页。每页20条，最多8次请求（含按需书籍详情）。15分钟内复用同条件缓存，refresh强制刷新。问题只用于本地整理，不发给微信读书接口。
- `readers-list [--session id] [--view popular|resonance|perspective] [--offset n]`：离线目录、对应视角和候选摘录（每次20条，每条正文≤500字、原文≤100字）。
- `readers-curate --input <JSON文件>`：保存实际候选的推荐理由，字段和流程见 [readers.md](readers.md)。随后运行 `workspace --open`。

最近10次发现保存在账户独立的本机文件中，旧缓存淘汰不会改动笔记和卡片。网络失败、429或升级要求不会覆盖已有发现，也不会自动反复重试。刷新成功后原推荐理由清空，须基于新快照重新整理。


## 共读书签（离线）
- `bookmarks [--query 书名] [--offset n]` 只列书名、键、日期，每页最多 20 本。手工书名可含作者或版次，续谈沿用原名称。
- `bookmark-resume <key> [--offset n]` 对选定书按新到旧取两次判断，各含依据、问题与待解问题。返回 null 的 nextOffset 表示已到末页。
- `bookmark-save --input <文件>` 保存已确认的具体内容。手工书示例：
  ```json
  {"title":"山间来信","parent":null,"question":"为什么要放慢？","judgment":"我觉得作者想要更多观察的时间。","excerpt":"时间从不匆忙，匆忙的是我们。","nextQuestion":"后一章的选择支持这个判断吗？"}
  ```
- 微信读书书架使用 bookId 替换 title。选用本书已载入笔记时，用 noteId 替换 excerpt，只保存选定笔记的有限摘录（划线和个人想法各最多 800 字符）。也可在同一 bookId 下用手工摘录补充。手工摘录最多 2000 字符，超长时请读者选择范围。书签键带有来源前缀，写入时使用原书名或原始 bookId。
- 续谈用当前条目 id 替换 parent。新增条目保留上次判断；重复相同输入只保存一次。保存、备份、恢复均按当前本机账户空间隔离。未配置微信读书时写入本机未连接空间。
