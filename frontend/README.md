# 金融决策实验前端

React / TypeScript / Vite 桌面前端。只实现页面、流程与可替换的 `ExperimentGateway`，未接入真实后台或 AI 服务。

## 本地运行

```bash
cd frontend
npm install
# 首次准备内容工具，见根目录 docs/content-maintenance.md
npm run dev
```

打开 http://127.0.0.1:5173/ 。使用 `--strictPort`，端口已占用时会明确退出，不静默切换端口。服务需保持运行。

开发编码：`FCM-2026`（3 项）、`FCM-SINGLE`（1 项）、`FCM-PROBE`（带中途判断）、`FCM-ALL`（20 项）、`FCM-EMPTY`（空任务）。`FCM-EXPIRED` 用于检查过期提示。编码仅供本地验证，参与者页面不列出它们。

开发数据保存在标签页 `sessionStorage`。刷新可恢复已经提交的阶段与消息；关闭标签页并不等于服务端持久化。需要全新开发数据时，在独立测试标签页清除存储；不要在有价值的用户会话中操作。

## 界面与流程

界面版本 `0.3.0`，固定语言 `en`。白色阅读区配极淡青灰、水蓝及暖白背景，深青绿用于主操作，完成状态为绿色；决策选中态为石墨灰。无外部字体或图片依赖。顶部与 favicon 共用中性文档图标。

桌面最小宽度 1100px。工作区约 58:42 双栏，左侧完整材料，右侧题干及作答/对话；两栏独立滚动，提交按钮在右栏底部。表格水平及垂直居中，选项列头与数据按相同 option.id 映射。没有手机端重排。

流程：编码 → 任务列表 → 独立 Profile → 任务列表 → 阅读与初始判断 → 对话（按返回策略可触发当前判断）→ 最终判断 → 保存确认 → 完成 → 任务列表。

- Profile 置顶，每个规范化编码只提交一次；题项仍是原开发配置，正式内容待用户提供，不在本次视觉修改中重设计。
- 自由选择任务，开始后锁定。列表支持 20 项，操作栏粘附底部，最后一行有足够空间，不被操作栏遮挡。
- 公共说明在编码页完整显示，任务列表以可展开的紧凑区提供；实验工作区不重复展示。
- A/B、初始/当前/最终判断不预填、不继承历史答案。置信度使用空白数值框，接受 0–100 整数，两个端点合法。移除有可见默认位置的滑杆。
- 结束确认只说明进入最终判断及无法回到对话；Send 与 End conversation 易于发现且样式接近。
- `Back to tasks` 在未完成时先确认；确认后清除该任务的作答、对话与事件并返回任务选择页，保留编码凭证、已提交 Profile 和已完成任务。取消或 Escape 保留状态。不会退回编码入口。
- 最终判断保存后进入 `finishing`，完成请求成功后才显示 saved；失败可以重试，无须重复回答。当前没有正式 Consent、Post-test 或 Debrief，内容确定后再接入。

## 英文内容与材料边界

`src/app/copy.ts` 集中管理固定英文界面文案、状态及本地错误；`UI_VERSION` 和 `UI_LOCALE` 标识当前界面。所有阶段呈现事件包含实际渲染界面版本和语言，包括恢复的旧会话。

`shared/copy/en.yaml` 是 `shared/instructions.md` 的独立英文译稿，覆盖入口说明和公共选择、置信度及阶段提示。保留原中文源文件；译稿记录其 SHA-256 `source_revision`。材料生成器在源版本变化时停止，要求先核对译稿，避免静默使用旧译文。英文文件自身的哈希用于共享文案版本，原始版本仍记录在快照中。

**目前不能称为完整英文实验**：20 个案例的标题、正文、选项、任务题干、术语与 42 份 PDF，以及 Profile 题项均保持原文。AI 回复来自可替换的本地实现，不代表已接入正式英文 Agent。本轮没有修改案例事实、数字、评分或正式 Profile 设计。

案例的新增、双格式同步、实验任务配置和后端接入说明见 [根目录维护指南](../docs/content-maintenance.md) 与 [项目架构](../docs/architecture.md)。首次运行前需按指南建立项目 .venv 并安装 requirements-tools.lock.txt；npm 会使用该环境。

正式使用前的内容清单：

| 内容 | 现状 / 后续 |
| --- | --- |
| 固定 UI 与错误、加载、无障碍标签 | 已英文化；术语集中管理 |
| 公共说明、置信度与阶段提示 | 独立英文译稿；正式采集前仍需译审 |
| 20 个案例及任务列表中的案例标题 | 保留原文，待内容负责人提供英文版本 |
| 42 份材料 PDF | 保留原文，待提供对应英文资料并核对版本 |
| Profile | 原题项保留；待用户专题设计及提供英文版本 |
| 正式 Agent | 后台接入时确定回复语言与版本 |
| Consent / Post-test / Debrief | 尚未提供正式内容，未创建空白参与者页面 |

`npm run dev` 和 `npm run build` 先执行 `../tools/prepare_frontend.py`（旧 scripts/prepare_materials.py 保留兼容入口）。它校验根目录 cases/catalog.yaml、case YAML 与保留的 material.md，并复用材料读取器，只打包参与者内容和 PDF，不包含研究者答案、隐藏 Goal、来源底稿和源文件路径。公开的 `instructions.json` 只包含 welcome 与 revision；编码验证前不加载场景快照。任务开始后冻结 Scenario、SharedCopy 和材料版本，恢复使用原快照。

生成目录 `public/materials/`、`src/generated/` 与 `dist/` 不纳入 Git，不手改。更新内容后运行 `npm run materials`，新任务才使用新版本；已开始任务继续保留旧快照和文案。

## 接口与状态

- `src/app/`：入口、布局、固定英文文案和样式。
- `src/access/`：编码、任务列表、独立 Profile、会话恢复及公共说明。
- `src/content/`：共享契约的兼容导出与材料加载；公共英文译稿已移至根目录 shared/copy/。
- `src/experiment/flow/`：阶段转换的纯函数。
- `src/experiment/state/`：异步提交、请求标识、重试和事件。
- `src/experiment/components/`、`screens/`：共享材料、判断、对话和弹窗。
- `src/questionnaire/`：配置化 Profile 容器；题项从根目录 shared/questionnaires/ 编译，正式内容待确定。
- `src/integration/`：中立契约的兼容导出、读取生成实验配置的 Mock、预留 HTTP 工厂。

入口状态为 `code / tasks / profile / active`；实验阶段为 `pre / dialogue / post / finishing / complete`；对话子状态为 `ready / waiting / probe / confirm`。

根目录 `contracts/gateway.ts` 的 `ExperimentGateway` 定义应用需求，不预设 HTTP 路径；DTO 从 `contracts/schemas/runtime.schema.json` 生成，前端旧类型路径继续兼容：

| 操作 | 职责 |
| --- | --- |
| getExperimentInstructions | 公开入口说明及版本 |
| verifyTestCode / getAccessGrant | 校验或恢复凭证、有效期和显示编码 |
| getTasks | 任务编号、标题、状态 |
| getParticipantProfile / submitProfile | 按编码身份获取和提交一次 Profile，与任务会话独立 |
| startTask / resumeTask | 创建、锁定或恢复会话及冻结材料 |
| submitDecision | 保存 pre / probe / post；请求标识保证重试幂等 |
| sendMessage | 用户消息、AI 回复和最新 canEnd / probeRequired；消息 ID 保证幂等 |
| endDialogue | 校验能否结束 |
| abandonTask | 校验归属，丢弃未完成进度并释放锁；已完成结果保留 |
| recordEvent | 阶段呈现、文件打开、资料展开、结束；呈现事件附 UI 版本及语言 |
| completeSession | 确认完成并返回凭证 |

后续仅替换 `App.tsx` 的 gateway 工厂即可接入正式服务。`http.ts` 未配置，不猜测地址或发出网络写入。后端必须独立校验编码、归属、锁定、状态、幂等和访问权限；浏览器存储及隐藏按钮不构成安全控制。当前静态材料可直接访问，正式权限需要服务端实现。

服务端还负责参与者身份、随机化、隐藏条件、轮数规则、真实 Agent、持久化和跨设备恢复。前端不根据文案自行随机、不暴露隐藏条件，不将 Profile 或各时点决策塞入对话请求。非内容事件不等于已阅读、理解或违规判定。

## 验证

```bash
npm test
npm run build
npm run test:e2e
```

macOS 默认使用已安装的 Chrome；可通过 `FCM_CHROME_PATH` 指定浏览器。其他环境可先安装 Playwright Chromium。截图输出到根目录 `build/frontend-qa/`。

检查覆盖完整 Probe 流程、无效/过期编码、任务自由选择与开始锁定、刷新恢复、独立 Profile、退出取消/确认、全部完成、空列表、入口说明加载重试、所有案例和 PDF，以及 1366×768 / 1920×1080 的双栏和滚动。新增验证置信度空值/整数边界/非法值、返回焦点、选项列映射和 20 项长英文任务列表。

当前尚未部署；正式采集前还需英文内容译审与真人 Pilot。
