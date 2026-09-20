# 读书搭子

读书搭子当前的产品形态是 **WorkBuddy 专家 + 内置本地 Skill + 用户自己的阅读工作台**：专家负责阅读陪伴与整理方法，Skill 在用户电脑本地同步、查询和保存数据，阅读报告作为每个用户独立生成的工作台。数据只保存在用户电脑上。

## 本机使用

用户不需要启动浏览器、本地网页服务或终端。WorkBuddy 通过本地 stdio 连接器启动组件并展示内嵌界面。

需要 Node.js 22 或更新版本。在项目目录运行：

```sh
npm ci
npm run build
npm start
```

`npm start`、`启动读书搭子.command` 和 `npm run dev` 仅用于开发或排障；它们使用的 `localhost:3788` 不是面向用户的运行方式。

正式连接器使用 WorkBuddy 的本地凭证表单配置微信读书 API Key。它以密码字段保存并仅注入本地连接器进程，不进入看板、聊天文本、备份或模型工具参数。开发预览仍保留旧的本地设置页，便于调试。

没有业务云端、远程数据库或公共 API。用户书架、笔记缓存、目标、卡片和备份都按电脑本地账户隔离。使用 WorkBuddy 云端模型分析时，只有用户主动选择的内容会进入该模型任务。

## 已实现

- 今日原始阅读时长、每日目标、主读书与有效阅读链接。
- 电子书书架搜索、筛选、逐批展示与选择主读；有声书和文章收藏数量单独说明。
- 个人笔记按书更新，区分划线与想法，保留书名、章节、日期和来源。
- 保存个人回顾，整理可编辑卡片，导出 Markdown；查看、编辑历史卡片。
- 本周/本月复盘草稿，缺失数据明确标注。
- 本机持久化、独立示例模式、备份导出及合并导入；导入前自动保存恢复副本。
- WorkBuddy 的 6 个 MCP 工具，以及内嵌 HTML 阅读概览资源。

## AI 与本机整理

网页里的“生成读书卡片”和“生成阅读复盘”是在本机组织已有数据，**不会伪装为 AI 生成，也不会自动调用其他模型 API**。

需要 AI 分析时，使用“交给 WorkBuddy”复制任务，或者在 WorkBuddy 中调用连接器。WorkBuddy 获取指定笔记、形成草稿；用户确认后调用 `reading_save_card` 写回应用。连接器不会发布微信读书书评，也不会自动发送邮件、消息或创建提醒。

## 专家发布候选包（当前主路径）

当前状态：专家 v0.3.0 已于 2026-09-14 提交 WorkBuddy 开放平台审核，ID 为 `oe_cab59592a0d1949b`，状态“审核中”。职称“读书搭子”、花名“海纳·读书专家”，作者联系邮箱 `1711496337@qq.com`。尚未确认审核通过或公开上架，详见 `workbuddy/PUBLISHING.md`。

专家是用户在 WorkBuddy 中发现和召唤「读书搭子」的入口，内置 Skill 执行本地授权、同步、笔记整理、卡片保存和报告生成。它不依赖 Buddy 应用 OAuth、不声明 MCP 或连接器依赖。

```sh
npm run build:expert
npm run package:expert
npm run test:expert
```

发布候选包生成在 `dist/expert/reading-buddy-expert-0.3.0.zip`。它包含专家元数据、头像、Agent 定义和完整本地 Skill，不包含用户数据、微信读书凭证、MCP 服务或连接器包。提交专家审核前，仍需在 WorkBuddy 客户端导入该 ZIP 并走通首次授权、同步和本地报告生成。

用户可在专家市场召唤读书搭子，也可从灵感案例「做同款」生成自己的阅读工作台。灵感案例只能使用虚构数据；不能上传用户报告、书架、笔记或备份。

## 原有连接器路径（保留）

1. 将 `workbuddy/` 作为连接器包导入 WorkBuddy。包内有 `connector-meta.json`、`mcp.json`、`token-schema.json`、图标、技能、完整内嵌界面和本地连接器程序。
2. WorkBuddy 使用托管 Node 运行时启动 `reading-buddy-connector.mjs`，用户电脑不需要预装 Node。
3. 首次连接时，WorkBuddy 显示“微信读书 API Key”密码表单；填写后只保存在 WorkBuddy 本机凭证存储中。
4. 在 WorkBuddy 中启用连接器后，发起“打开我的阅读看板”即可使用其内嵌界面；该连接器不等同于已创建或已发布的 Buddy 应用。

连接器不创建 HTTP 监听端口，不读取 `runtime.json`。微信读书 API Key 不在连接器包、工具参数、工具返回值或备份中。

已验证标准 MCP 握手、8 个工具、完整 HTML 阅读界面资源、限定书籍的笔记查询及确认后的写回；测试中未启动 HTTP 服务。**尚未在 WorkBuddy 客户端实际导入该包并完成宿主联调**，这是正式发布前的最后平台验证项。

## 开放平台交付边界

`workbuddy/` 是可分发的本地连接器包，包含元信息、图标、stdio 配置、凭证表单、技能、本地连接器和完整内嵌界面。它没有用户数据、API Key、绝对路径或本地端口配置。

连接器包已提交 WorkBuddy 开放平台审核，**尚未确认审核通过与公开发布**。Buddy 应用不再是当前主发布路径：它需要 OAuth 注册与授权配置，而读书搭子的本地个人化场景由专家 + Skill 更直接承载。保留 Buddy 应用材料仅供未来出现专属品牌入口、多工作模式和行业能力市场需求时再评估；不要将个人 `data/`、开发预览配置或访问凭证放入公开包。

本项目虽沿用了带静态构建适配的界面模板，但正式功能依赖 Node 本地服务；**仅部署 `dist/client` 或模板 Worker 不会得到完整可用产品**。不要直接把模板托管产物作为公网应用发布。

## 免连接器 Skill 路径（新增，v0.3）

除已提交开放平台审核的 v0.2 连接器（审核结果未确认，尚不能称为已发布）外，项目现在提供**免连接器**的 Skill 形态：不注册连接器、不启动 MCP 服务器、不需要云端业务托管或 localhost:3788，直接在用户电脑通过 WorkBuddy 的本地 Bash 工具权限执行打包脚本。

```sh
npm run build:skill   # 生成 dist/skill/reading-buddy/（esbuild 打包单文件脚本 + SKILL.md + references + 报告内嵌素材）
npm run test:cli && npm run test:skill
npm run cli -- status # 本地直接使用入口（该入口固定为 Skill 行为，无需也不应设置内部模式变量）
```

Skill 脚本覆盖：status、sync（等待完成）、分页书籍搜索、按书笔记查询/刷新、目标与主读书设置、个人回顾、卡片/复盘草稿与保存、备份导出/校验导入、自包含只读 HTML 阅读报告（今日/书架/笔记/复盘四区，复用已生成的阅读灯/示例书图片素材并内嵌）。输出为确定性 JSON，退出码区分参数错误(2)、缺少授权(3)、不存在(4)、请求频繁(5)与其他错误(1)。无效选项（非法 `--mode`、未知 flag、非数字分页、非法 `--status`/`--kind`/settings 子命令）一律明确报错，不静默降级；长文本支持 `--body-file` / `--reflection-file` / `--text-file` / `--input <json文件>` 从本机文件读取，避免 shell 转义。

**运行前提**：WorkBuddy Skill 的脚本通过本地 Bash 执行，需要用户本机装有 Node.js 20+；普通 Skill **不会自动获得连接器托管的 Node 运行时**。

**一次性凭证配置（无连接器凭证表单）**：让用户把微信读书 API Key 用系统文本编辑器保存为本机文件（仅一行），然后执行 `node scripts/reading-buddy.mjs auth import <文件>`；凭证以 0600 保存到用户级配置目录（也可用 `auth revoke` 移除，`auth status` 查看状态）。也可以直接设置 `WEREAD_API_KEY` 环境变量（优先于凭证文件）。Key 永不作为命令参数、不进入输出、备份或报告。Skill 数据默认存放在用户级平台数据目录，按凭证哈希隔离账户。

**已知限制**：官方文档未提供 Skill 内嵌 GUI 直接写数据的宿主桥接，因此该路径的数据更新均为显式命令，HTML 报告为只读快照（页内搜索/筛选只影响显示）；移除连接器不会移除 Buddy 应用注册时填写的 scope / OAuth 字段，需平台侧另行处理。v0.2 连接器路径保留不变，两种形态共享同一套领域/存储/服务逻辑与数据格式。

## 数据与限制

- `data/profile-*.json`：按凭证隔离的个人阅读快照、目标、卡片和回顾。
- `data/demo.json`：示例数据与示例卡片。
- `data/before-import-*.json`：导入前恢复副本。
- 备份不含凭证或运行令牌。合并时采用更新的卡片/回顾版本，保留当前设置。
- 首次同步载入书架、周/月统计、最近100本笔记概览、12本书的详细信息及最多2本书的笔记内容。剩余笔记可以从书架进入对应书籍后同步，不能将首批内容称为全库导出。
- 阅读总时长以接口 `totalReadTime` 为准，按秒处理；缺失不填0。单本时长仅显示确有本周来源的值。
- 已读完状态与本期读完日期分开。只将有明确完成日期的记录纳入复盘列表。
- 当前只提供本周与本月；不含任意历史周期选择。
- 封面来自微信读书返回的图片域名；不可用时显示明确的缺图状态。示例封面不会冒充真实书籍。
- 首版无跨设备自动同步、云账户与付费功能。

## 验证

```sh
npm test
npm run test:mcp
npm run test:cli
npm run test:skill
npm run build
```

测试覆盖日期及时区、总量口径、1%进度、缺失值、安全链接、备份校验与幂等合并、HTTP流程、重启恢复和 MCP 协议。自动化使用隔离的示例数据目录，不读取或修改个人微信读书账号。

浏览器已验收真实数据首页、示例卡片生成与保存/重载、书架搜索、复盘界面，以及桌面和窄屏布局。详细记录见 `design-qa.md`。

## 素材

首页背景 `public/assets/reading-light.png` 和示例封面 `public/assets/demo-book.png` 使用内置 ImageGen 生成。提示分别为“暖纸白、右下翻开的书、右上柔和枝叶、左侧留白，无文字UI”和“山间来信、林禾、暖纸白、淡墨青山与松树，正面完整示例封面”。图标采用 Phosphor，标题字体使用 Noto Serif SC / 系统宋体回退。

## 参考

- [WorkBuddy Buddy 应用](https://open.workbuddy.cn/docs/buddy-app)
- [WorkBuddy 连接器](https://open.workbuddy.cn/docs/connector)
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)
