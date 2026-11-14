# 金融决策实验前端

React / TypeScript / Vite 桌面前端。开发模式默认本地 Mock；HTTP 后端支持确定性回复与经过验证的真实 Advisor，运行边界见 [Advisor 说明](../docs/advisor-runtime.md)。

## 研究控制台

独立入口为 http://127.0.0.1:5173/admin.html ，实现位于 `src/admin/`，复用现有配色与字体，始终接真实管理 API。启动后端及登录口令的位置见 [后端运行说明](../backend/README.md#研究控制台)。

已支持研究者登录/退出、真实总览、自选实验条件的一步批量发码、原码随时查看/复制/导出、换码/取消、参与记录分页筛选、Profile 与历史尝试回放。支持查看已退出的记录、0 信心度、部分消息和排队状态；未接入的模型/工具/策略不生成模拟轨迹。管理端不改写原始实验记录，所有业务变更走授权 API；凭证及原码不保存在 localStorage/sessionStorage 中。页面时间、到期时间输入、CSV 时间固定使用北京时间；本地默认登录口令为 `123456`。当前正式案例为空时，管理端任务和 Advisor 验收会显示无可用案例。

Vite 同时构建 `index.html` 和 `admin.html`；管理端使用哈希路由，不增加路由库。部署时同源代理 `/api` 并保留原始 Host。管理接口类型在 `src/admin/types.ts`，参与者公开契约仍在 contracts；管理字段不进入参与者 DTO。`tests/http-browser/empty-study.spec.ts` 通过独立真实数据库验证没有正式案例时 HTTP 入口仍可启动。

设置页（`#settings`）支持持久维护环境名称、备注、多个模型的显示名称、接口地址、API Key 与模型名，并展示当前运行信息。API Key 可留空保留、替换或删除，读接口不回显；发码页可为整批选择一个模型；不选时使用确定性回复；真实模型需通过 Advisor 验证，再创建新的预览并发放，旧批次继续使用其冻结配置。发码页任务区只显示 `01`–`20` 两位数，压缩为数字网格；管理端任务详情也使用相同编号。

控制台默认采用紧凑布局：184px 侧栏、44px 顶栏、较小卡片间距及表格行高；总览直接显示统计与最近 10 条记录，宽屏发码页并排显示配置，设置页使用双列模型字段。较窄窗口自动调整列数，参与者页面样式不受管理端样式影响。

设置修改带未保存提醒，导航/后退/刷新数据/退出时可取消离开，浏览器刷新或关闭使用原生提醒；密钥草稿只在内存中。设置下方可查询持久化模型验证记录及费用核对依据。Worker 状态独立于 API/数据库状态，每 10 秒更新。新增 `#batches` 批次汇总，可复制任务、各组人数与轮数到新发放表单；原批次与凭据保持不变。参与记录搜索支持直接粘贴 `FCM · XXXXXXXX` 显示编号。

预设 GPT-5.4 mini 固定版本后，在“设置 → 可选模型 → GPT-5.4 mini（联调）”填写 API Key 并保存，可点击独立连接验证。保存本身不调用供应商；额度面板显示本部署累计 $1 上限、结算/预占/剩余。连接验证不创建参与者；完整 Advisor 验证用于检查工具、策略和正式回复协议，实际使用流程见 [Advisor 运行说明](../docs/advisor-runtime.md)。请求结果不明时保留请求编号，点击查看原结果不会重复支付。

## 本地运行

```bash
conda activate FCMScenario
python -m pip install -r requirements.txt
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。使用 `--strictPort`，端口已占用时会明确退出，不静默切换端口。服务需保持运行。

开发编码：FCM-EMPTY（空任务入口）。正式案例接入后，开发编码由 studies/fixtures/local-codes.yaml 随配置更新；编码仅供本地验证，参与者页面不列出它们。

开发数据保存在标签页 `sessionStorage`。刷新可恢复已经提交的阶段与消息，也会恢复同标签页未提交的判断、置信度、消息及 Profile 草稿；草稿不会自动提交。关闭标签页不提供跨标签页或服务端持久化保证。需要全新开发数据时，在独立测试标签页清除存储；不要在有价值的用户会话中操作。

## 重复测试：重置某个测试码

运行 npm run dev 后，刷新本地页面，在浏览器控制台（macOS Chrome：Option + Command + J）使用下列命令。工具仅在开发环境安装，不增加页面按钮、提示、路由或查询参数，生产构建不包含此工具。

```js
// 重置当前编码的全部任务，保留已提交的 Profile 和未提交的 Profile 草稿。
fcmDev.resetCode()

// 当前编码全部重置，包括 Profile 答案和 Profile 草稿。
fcmDev.resetCode({ includeProfile: true })

// 指定另一个编码；默认保留它的 Profile。
fcmDev.resetCode({ code: 'FCM-EMPTY' })
```

执行成功后自动刷新。当前编码的凭证仍有效时回到任务选择页，任务重新变为 Ready；若重置了 Profile，需先重新完成问卷。其他编码的记录保留。指定另一个编码不会切换当前身份。没有登录编码时需要显式提供 code；编码忽略前后空格和大小写，未知编码拒绝操作。

清除范围包括该编码所有凭证下的未完成及已完成任务、判断、消息、事件、任务锁、开始请求记录、已放弃任务记录及关联的会话草稿。默认保留 Profile。开发重置版本会使刷新前仍在等待的旧请求失去写入资格，避免恢复已清除的旧数据；存储操作失败时尝试回滚，不显示成功结果或自动刷新。

实现位于 src/dev/tools.ts，main.tsx 只在 import.meta.env.DEV 分支动态加载。它仅管理当前标签页的本地 Mock 数据，不重置真实后端或其他标签页。新增此工具不会自动清除当前浏览器里的任何作答；需在目标标签页明确调用命令。

## 界面与流程

界面版本 `0.7.0`，固定语言 `en`。暖白底色配淡青绿、水蓝和浅杏色。编码入口、任务选择与 Profile 使用阅读、文件夹和笔记本水彩插画；正式材料区域保持中性。编码页的研究说明与输入卡片并排，阅读确认后才能 Begin，底部 01–03 介绍初始判断、AI 讨论和最终判断。

实验工作区保持 58:42 双栏与独立滚动。左侧是连续材料阅读区，Situation 与 Decision reference information 分组，后者包含选项、共同条件、PDF、补充资料和术语；表格居中，PDF 使用红色图标。右侧承载初始/最终判断与对话，主操作使用深青绿，用户消息靠右并按文字长度收缩，助手正文靠左。具体间距、字体和颜色维护于 `src/app/styles.css`，本说明不重复记录每次样式调整。

置信度的题目与说明统一维护在 shared/copy/en.yaml；采用已确认的精简稿，删除三个刻度后的第一人称复述及重复定义，保留当前时点、主观确定感、任意整数、三个锚点、概率边界与中性填写说明：confidence_prompt 为当前选择的确定感问题，confidence_scale 为定义、0–100 整数填写规则及 0 / 50 / 100 三个文字锚点，confidence_notes 为输入框后的测量边界与中性填写提示。初始、最终及启用时的中途判断复用同一表单及冻结文案；说明始终展开，正文 14px、行高 1.5，锚点纵向排列且不加独立卡片，不预填分数或展示上一阶段答案。较矮电脑窗口使用右侧原有内部滚动，初始与最终判断的提交按钮仍固定可见。旧会话缺少 confidence_notes 时保留原有说明，不在已开始的任务中途替换量表含义；返回任务列表并重新开始后使用新版。

任务列表底部的进度提示使用两个操作按钮之间的可用宽度，不再限制为 380px；背景问卷入口将 Before you begin 放在标题上方，说明占用完整内容宽度。比较表首列从 25% 适当增至 28%，减少短属性名在窄桌面窗口中的零碎换行，长内容仍可自然折行。

新任务的 AI 开场白使用决策帮助邀请，说明可以询问材料或表达不确定之处，文案集中在 ui.dialogueOpening；已保存会话保留原有消息。对话记录区去掉独立的背景、边框与圆角，AI 回复靠左直接排正文，用户消息靠右使用浅灰蓝气泡；气泡按文字长度收缩，长消息最多占对话区宽度的 85%，保留换行和小字角色标识。Send 使用深青绿色实心底和白字，End conversation 使用白底描边；禁用状态保持淡色。发送、等待、中途判断、滚动跟随与结束流程保持。

三幅在用插画的透明 WebP 位于 public/illustrations/；原始 PNG、完整提示词和生成记录见 [design/illustrations/README.md](design/illustrations/README.md)。Profile 插画复用备用库中的 filed-notes，通过 StudyIllustration 组件引用，完成页沿用入口插画，显示尺寸 240×160px；两段说明文字采用 1.5 倍行距，段间距 4px，顶部完成阶段编号保持绿色可辨。实验材料与选项区域不插入装饰图像。图像使用空 alt 和 aria-hidden，不进入无障碍阅读顺序，也不改变实验条件、案例或题项。

主要标题使用随项目保存的 Source Serif 4；正文、表单和编号恢复原来的系统无衬线字体栈（macOS 系统 UI 字体、Windows Segoe UI，以及 Helvetica Neue / Arial 和中文回退）。保留 40/32/28/16/17/15/13px 的展示标题、页面标题、材料标题、章节标题、正文、操作及辅助字号。字体原件、许可证及 SHA-256 记录位于 public/fonts/；已停用的 Source Sans 3 文件已清理。运行时不访问外部字体服务，正文的实际字形随操作系统而异。顶部与 favicon 共用中性文档图标。

桌面最小宽度 1100px。工作区保持 58:42 双栏，左侧完整材料，右侧题干及作答/对话；两栏独立滚动。提交按钮紧随表单，长题内容区收缩滚动时操作仍在可见范围内。表格水平及垂直居中，选项列头与数据按相同 option.id 映射。没有手机端重排。

流程：编码 → 任务列表 → 独立 Profile → 任务列表 → 阅读与初始判断 → 对话（按返回策略可触发当前判断）→ 最终判断 → 保存确认 → 完成 → 任务列表。

- Profile 置顶，每个规范化编码只提交一次；题项仍是原开发配置，正式内容待用户提供，不在本次视觉修改中重设计。
- 原发码任务自由选择，开始后锁定；独立“配额随机分配”生成的任务显示序位并按固定顺序逐项解锁。列表支持 20 项，操作栏粘附底部，最后一行有足够空间，不被操作栏遮挡。控制台新入口的配额、预览和历史见 [配额随机分配](../docs/quota-allocation.md)。
- 公共说明在编码页完整显示，任务列表以可展开的紧凑区提供；实验工作区不重复展示。
- 每个新会话和新判断阶段不预填、不继承历史答案；刷新恢复仅限当前会话、当前阶段的未提交输入。置信度使用空白数值框，接受 0–100 整数，两个端点合法。无效或不完整的草稿保留原输入，仍需通过校验才能提交。
- End conversation 从对话开始就显示，在策略尚未允许结束、等待回复或中测未提交时禁用。未达到最低交流轮数时显示最低值或剩余轮数；一轮指一条用户消息得到 AI 回复，开场白不计入。达到结束条件后提示进入最终选择，等待回复或需要提交中测时显示对应提示。轮次来自服务返回的 DialoguePolicy，不根据浏览器消息数猜测；旧接口缺少数值时使用通用提示。结束前确认无法返回对话；若存在未发送消息，明确说明将舍弃该草稿。
- `Back to tasks` 在未完成时先确认；确认后清除当前可恢复进度与本地草稿并返回任务选择页，保留编码凭证、已提交 Profile 和已完成任务；HTTP 后台关闭并保留旧 attempt 的作答、对话和事件。取消或 Escape 保留状态。不会退回编码入口。
- 最终判断保存后进入 `finishing`，完成请求成功后才显示 saved；失败可以重试，无须重复回答。当前没有正式 Consent、Post-test 或 Debrief，内容确定后再接入。

## 英文内容与材料边界

`src/app/copy.ts` 集中管理固定英文界面文案、状态及本地错误；`UI_VERSION` 和 `UI_LOCALE` 标识当前界面。所有阶段呈现事件包含实际渲染界面版本和语言，包括恢复的旧会话。

手动更新首页时，对应字段如下；顶部阅读提醒与编码帮助已分开，修改一处不会再把整句提醒复制到另一处。

| 位置 | 源文件及字段 |
| --- | --- |
| 顶部大标题与欢迎语 | `src/app/copy.ts`：`welcome`、`entryIntro` |
| 顶部阅读提醒 | `src/app/copy.ts`：`entryReadReminder` |
| 顶部邮箱前的文字 | `src/app/copy.ts`：`entryHelp` |
| 编码卡片的帮助文字 | `src/app/copy.ts`：`codeHelp` |
| 两处共用的邮箱 | `src/app/copy.ts`：`contactEmail` |
| Study instructions 正文 | `shared/copy/en.yaml`：`welcome` |

修改 `copy.ts` 后保存即可更新；修改 YAML 后在项目根目录运行 `npm --prefix frontend run materials`，再刷新页面。正文保留每行两个空格缩进，空行分段、行末反斜线换行、`- ` 表示圆点条目。

`shared/copy/en.yaml` 管理英文公共说明和文案，覆盖入口说明和公共选择、置信度及阶段提示；入口明确说明研究可能包含多个任务，每个任务约需 12–15 分钟。入口说明按用户提供的英文稿更新，其余文案沿用已保存的译稿。保留原中文源文件；英文文件以 SHA-256 `source_revision` 关联中文基线，这不表示首页说明仍为逐句对译。材料生成器在源版本变化时停止，要求先核对译稿，避免静默使用旧译文。英文文件自身的哈希用于共享文案版本，原始版本仍记录在快照中。

**当前正式案例尚未发布**：旧 20 个案例已从工作树移除，候选材料仍在 research/candidates/审核。通过审核后才生成英文 participant-facing case.en.yaml 并编入实验。Mock 当前用于检查入口和空任务状态；正式内容、Profile 和 Advisor 需在新案例接入后单独验收。

案例的新增、双格式同步、实验任务配置和后端接入说明见 [根目录维护指南](../docs/content-maintenance.md) 与 [项目架构](../docs/architecture.md)。首次运行前激活 Conda `FCMScenario` 并安装根目录 `requirements.txt`。npm 与 HTTP 浏览器测试通过同一 Python 入口运行，支持 `FCM_PYTHON` 显式指定 Python 3.12+；环境选择规则见维护指南。

正式使用前的内容清单：

| 内容 | 现状 / 后续 |
| --- | --- |
| 固定 UI 与错误、加载、无障碍标签 | 已英文化；术语集中管理 |
| 公共说明、置信度与阶段提示 | 独立英文译稿；正式采集前仍需译审 |
| 案例及任务列表中的案例标题 | 当前没有已发布案例；接入后由 catalog 和 study 配置生成 |
| 正式材料 PDF | 随已审核案例进入 cases/，候选来源留在 research/candidates/ |
| Profile | 原题项保留；待用户专题设计及提供英文版本 |
| 正式 Agent | 后台接入时确定回复语言与版本 |
| Consent / Debrief | 尚未提供正式内容，未创建空白参与者页面 |
| 额外后测问卷 | 本轮取消，最终 A/B＋置信度判断保留 |

`npm run dev` 和 `npm run build` 先执行 `../tools/prepare_frontend.py`。它校验根目录 cases/catalog.yaml 与正式 case YAML，并复用材料读取器，只打包参与者内容和 PDF，不包含研究者答案、隐藏 Goal、来源底稿和源文件路径。公开的 `instructions.json` 只包含 welcome 与 revision；编码验证前不加载场景快照。任务开始后冻结 Scenario、SharedCopy 和材料版本，恢复使用原快照。

生成目录 `public/materials/`、`src/generated/` 与 `dist/` 不纳入 Git，不手改。更新内容后运行 `npm run materials`，新任务才使用新版本；已开始任务继续保留旧快照和文案。

## 接口与状态

- `src/app/`：入口、布局、固定英文文案、样式、草稿读写及恢复提示。
- `src/access/`：编码、任务列表、独立 Profile、会话恢复及公共说明。
- `src/content/`：共享契约的兼容导出与材料加载；公共英文译稿已移至根目录 shared/copy/。
- `src/experiment/flow/`：阶段转换的纯函数。
- `src/experiment/state/`：异步提交、请求标识、重试和事件。
- `src/experiment/components/`、`screens/`：共享材料、判断、对话和弹窗。
- `src/questionnaire/`：配置化 Profile 容器；题项从根目录 shared/questionnaires/ 编译，正式内容待确定。
- `src/integration/`：中立契约的兼容导出、本地 Mock、HTTP/SSE Gateway 和结构化错误。

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

HTTP 实现已接入，启动方式见 [后端说明](../backend/README.md)，具体协议见 [HTTP 协议](../docs/http-protocol.md)。开发模式默认 Mock，设置 `VITE_GATEWAY_MODE=http` 启用服务端模式；生产构建默认 HTTP，并排除静态案例/PDF 和开发编码。HTTP 模式的材料、Profile、任务和进度从服务端读取；PDF 使用受控短效资源票据。

对话支持排队、部分回复、SSE 观察、同消息 ID 合并和原 turn 的刷新恢复。网络故障保留缓存与草稿，提供 Reconnect；达到轮数上限按服务端 stage 进入最终判断。完整码改为 codeDisplay，Profile 草稿按稳定 participantId 隔离。传输与行为测试之外，新增界面状态仍需目标受试者 Pilot。

服务端还负责参与者身份、随机化、隐藏条件、轮数规则、真实 Agent、持久化和跨设备恢复。前端不根据文案自行随机、不暴露隐藏条件，不将 Profile 或各时点决策塞入对话请求。非内容事件不等于已阅读、理解或违规判定。

## 未提交输入保护

`fcm.draft.v1:` 是独立的标签页草稿命名空间，不属于提交结果。判断按 session ID 和 pre/probe/post 隔离，消息按 session ID 隔离，Profile 按规范化编码隔离；材料和共享文案版本用于匹配会话草稿，题项配置用于匹配 Profile 草稿。24 小时未更新、版本不符或损坏的草稿不恢复。

每次编辑同步写草稿，刷新不自动作答或发送。提交成功后才清除对应草稿；失败保留输入。消息请求 ID 同时保留，恢复时按已接收消息 ID 对照，避免把已发送内容恢复成新的待发送消息；相同文字的新消息仍然可以发送。

确认返回清除当前未完成会话的全部草稿；取消不清除。Profile 返回确认只清除未提交的 Profile 答案，成功提交后也清除其草稿。完成任务清除会话草稿。草稿写入失败不阻止填写或发起提交，并提示不要关闭页面；正式提交是否成功仍以 Gateway 返回为准。当前本地 Mock 自身也依赖 sessionStorage，草稿保护不替代其存储要求，不会将草稿提示为已正式保存。

## 验证

```bash
npm test
npm run build
npm run test:e2e
```

macOS 默认使用已安装的 Chrome；可通过 `FCM_CHROME_PATH` 指定浏览器。其他环境可先安装 Playwright Chromium。Mock 检查截图输出到根目录 `build/frontend-qa/`；HTTP 测试截图随测试结果保存，可用 `--output /tmp/fcm-http-check` 指定临时目录。

当前浏览器 smoke test 覆盖入口说明、空任务状态和 HTTP 边界；通用单元测试继续覆盖阶段转换、草稿隔离、消息恢复、置信度边界和传输错误。正式案例接入后，再按案例材料补充浏览器验收。

当前尚未部署；正式采集前还需英文内容译审与真人 Pilot。
