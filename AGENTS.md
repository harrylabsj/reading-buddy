# Prototype Instructions

## Product requirement (2026-09-13)

The product must not require a hosted business server. Each user keeps independent local data and uses the full UI inside WorkBuddy. WorkBuddy launches the stdio MCP component; localhost:3788 is an optional development/legacy preview, not a runtime dependency. Credentials are provided through the local connector, never through model-visible tool arguments or UI messages. Do not publish packages or deploy without explicit authorization.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## 2026-09-14 更新：免连接器 Skill 路径（用户已确认）

项目在既有 MCP 连接器路径（`workbuddy/`，v0.2 已提交开放平台审核）之外，新增用户确认的**免连接器 Skill 形态**（v0.3：`skills/reading-buddy/` + `server/cli.mjs`，打包为 `dist/skill/reading-buddy/`）。上文“凭证只经由本地连接器提供”的规则**仅适用于连接器/web 路径**；Skill 路径下凭证由 `auth import <本机文件>` 导入 0600 私有凭证文件或经 `WEREAD_API_KEY` 环境变量提供，解析顺序为环境变量 → 凭证文件。冲突时以本条（新路径）为准，旧路径说明保留。

Skill 路径的实际限制：脚本经 WorkBuddy 本地 Bash 工具权限执行，需用户本机 Node.js 20+（普通 Skill 不自动获得连接器托管运行时）；HTML 报告为只读快照（页内交互只影响显示）；不依赖任何业务云端托管，数据仍在用户本机，按凭证隔离。两条路径共享同一套领域/存储逻辑。

## 发布联系信息（用户明确指定）

读书搭子作者及公开开发者联系邮箱为 `1711496337@qq.com`。专家元数据、后续版本及发布材料沿用此邮箱，不再重复询问；仅在用户主动要求时变更。此前 Gmail 发件记录是历史事实，不代表当前公开联系邮箱。

专家公开展示职称为“读书搭子”，花名为“海纳·读书专家”（用户明确指定）。同步维护 plugin.json 与 Agent 定义中的 profession/displayName。

专家花名统一命名规则为：“海纳·” + “某某专家”，例如“海纳·读书专家”。后续专家命名与发布材料直接沿用此规则，不再重复询问；仅在用户主动要求时变更。该规则用于花名，不替代专家职称。
