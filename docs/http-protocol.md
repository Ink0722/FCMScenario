# 实验 HTTP 协议 v1

本协议已用于第一、二批实现及研究控制台第一批。实验运行方式按批次冻结：deterministic 为确定性开发回复；agent 为经过独立验证的真实 Advisor（首版仅现有案例和本地材料）。连接验证及 Advisor 各阶段调用共享累计 $1 限制。额外后测问卷取消；post 仅指最终 A/B＋置信度。正式研究仍需案例目标、Prompt 及部署验收。

公开数据以 contracts/schemas/runtime.schema.json 为准；TypeScript 通过 tools/generate_contracts.py 生成。HTTP 请求使用 Pydantic 严格校验，所有核心参与者响应按共享 JSON Schema 验证。私有数据库字段不进入公开 DTO。服务端输出结构可在 /docs 和 /openapi.json 检查，公开 DTO 的详细定义见共享 Schema。

## 身份和资源

- POST /api/v1/access/exchange：{code, requestId}，返回 AccessGrant。
- GET /api/v1/access、POST /api/v1/access/refresh：校验并续发凭证。
- 其余业务请求使用 Authorization: Bearer accessToken；访问校验 participant_id、access_version、有效期和测试状态。
- AccessGrant 返回 participantId、codeDisplay、accessToken、expiresAt。codeDisplay 是不可登录的展示标识；HTTP 不返回原始测试码。
- PDF 使用 StartedTask 中的受控 URL，附带 5 分钟、限定 attempt/document 的资源票据。其签名盐与访问凭证分离，不能用于普通 API。换码/作废使旧票据失效。运行 API 时关闭含查询字符串的 access log；响应设置 no-referrer 与 no-store。
- /api/v1/instructions 公开；/api/v1/health 返回数据库连通状态和运行模式。

## 命令与恢复

| 操作 | 方法与路径 | 输入 / 返回 |
| --- | --- | --- |
| 获取/提交 Profile | GET/POST /api/v1/profile | 提交 {requestId,answers}；成功 204 |
| 任务列表 | GET /api/v1/tasks | TestTask[] |
| 开始任务 | POST /api/v1/tasks/{taskId}/start | {requestId} → StartedTask |
| 恢复尝试 | GET /api/v1/attempts/{attemptId} | StartedTask |
| 前测/最终判断 | POST /api/v1/attempts/{attemptId}/measurements/{pre或post} | DecisionSubmission → DialoguePolicy |
| 受理消息 | POST /api/v1/attempts/{attemptId}/turns | 用户 Message → 202 TurnSnapshot |
| 查询运行 | GET /api/v1/attempts/{attemptId}/turns/{turnId} | TurnSnapshot |
| 观察运行 | GET 同上路径/events | SSE 公共快照 |
| 主动结束 | POST /api/v1/attempts/{attemptId}/end-dialogue | {requestId}，204 |
| 完成任务 | POST /api/v1/attempts/{attemptId}/complete | {requestId} → {receipt} |
| 放弃当前尝试 | POST /api/v1/attempts/{attemptId}/abandon | {requestId}，204 |
| 流程事件 | POST /api/v1/attempts/{attemptId}/events | ExperimentEvent，204 |

TestTask.id 为个人任务 UUID，配置中的 task.id 是 task_code。Session.id 即 attempt_id。Message.id 即 turn_id，网络重发保持原消息 ID 和正文。数据库中一轮只能对应一个运行作业。

配额方案的 TestTask 增加可选 `sequence`，按该序位返回，仅首个未完成任务可开始，后续任务公开状态为 `unavailable`；跳序开始返回 `409 task_order_locked`。原发码安排保留自由选择。独立的 `/api/v1/admin/allocation-plans` 预览、历史、一次性发放及 CSV 接口见 [配额随机分配](quota-allocation.md)。

状态分层：task.status 使用 pending/in_progress/completed/cancelled；attempt.status 使用 in_progress/completed/abandoned/failed；phase 使用 pre/dialogue/post/finishing/complete，其中 finishing 表示最终判断已保存、待完成确认。turn 使用 queued/running/completed/interrupted/cancelled。作业成功状态为 succeeded，与 turn.completed 分开。

Profile、测量和消息按请求 ID 与正文摘要防重；同 ID 不同正文 409。Profile/测量同时执行业务唯一性校验，换新请求 ID 也不能覆盖原答案。完成重试返回同一回执。已进行中的 start 返回同一个 attempt；放弃后旧 start 请求不能恢复被关闭的 attempt。

最少 3 轮，默认上限 20；前端使用 policy.completedTurns/minTurnsBeforeEnd/maxTurns/canSend/canEnd 和 stage。上限只在完整回复写入后触发 post。中测关闭。启动/恢复/测量/消息结果均使用服务端状态。

StartedTask.progress 包含 activeTurn、revision 和已保存消息。刷新后先恢复；运行中继续观察原 turn。暂时断网保留访问缓存与草稿，不提交新消息。消息受理回执丢失时按原 Message.id 查询；确认未受理后，用户重试仍使用原 ID。

## SSE

事件类型为 turn.snapshot，id 为任务 revision，data 为 TurnSnapshot。快照包含当前 turn 的公开消息、运行状态、policy、stage、revision。助手部分消息使用同一消息 ID 更新，status 从 partial 变为 complete；按 ID 合并，不追加重复气泡。

每次连接首先提供持久化快照；可提交 Last-Event-ID，但当前不永久保存逐 Token 事件，也不承诺精确 Token 重放。连接约 25 秒结束后可重连观察原 turn。每次发快照重新校验授权；撤销或过期时发 access.error 并关闭流。最终快照只能在数据库事务成功后发出。前端收到 completed 更新阶段；interrupted/cancelled 保留部分内容并停止输入。

## 错误

统一返回 {code,message,requestId}。401 表示编码/凭证过期、撤销或无效；403 管理权限不足；404 归属范围内找不到对象；409 幂等或阶段冲突；422 参数或配置不合法；429 编码尝试过多。连接错误和服务临时失败保留缓存；401/403 的访问恢复失败才回到编码入口。

## 当前研究者接口

研究者凭证仅服务端配置，不进入参与者前端。

浏览器通过 `POST /api/v1/admin/login` 提交 `{password}`，本地默认口令为 `123456`，可通过 FCM_ADMIN_TOKEN 自定义（至少 6 字符）。成功设置限管理路径的 HttpOnly、SameSite=Strict Cookie（HTTPS 时 Secure），返回 `{actor,expiresAt,csrfToken}`。会话有效期 8 小时，绑定当前管理口令摘要与数据库中的 admin_session 控制作业；`GET /api/v1/admin/session` 恢复页面会话。浏览器写请求附带 `X-CSRF-Token`，验证来源 Host 与浏览器跨站标识；同源代理保留原始 Host。`POST /api/v1/admin/logout` 验证 CSRF、撤销数据库会话并删除 Cookie；旧 Cookie 不能重新使用。登录按进程、客户端 IP 限制为每分钟 10 次；多实例部署还需统一入口限流。CLI 仍可使用 `Authorization: Bearer FCM_ADMIN_TOKEN`，不依赖 Cookie/CSRF。

只读查询（均需要管理授权）：

| 路径（前缀 /api/v1/admin） | 返回 |
| --- | --- |
| GET /settings | 可编辑环境信息、models 多模型连接列表（仅返回 hasApiKey，不回显 Key）、当前运行版本/数据库/路径；不回显任何连接密钥 |
| POST /models/probe | `{requestId,modelId}`；仅预设 GPT 固定版本的独立付费连接验证，需要已保存密钥及足够预占额度；同一 requestId 不重发；不创建参与者 |
| POST /models/validate-advisor | `{requestId,modelId,taskCode?,condition?,targetOptionId?,turnCount?}`（默认案例 01、Neutral、1 轮；可选 3 轮）→ 持久化独立 Advisor 验证作业，Worker 执行；同编号只查询原作业，不重发 |
| GET /models/advisor-validations/{jobId} | 查询验证状态、实际策略/工具/模型记录及额度，不调用供应商 |
| POST /model-budget/estimate | `{modelId?,taskCount}`；最低轮数参考费用及剩余，不调用供应商、不预占预算 |
| GET /research/export | 与参与者列表相同筛选范围的研究 ZIP，详情见 [研究导出](research-data-export.md) |
| GET /tasks/{taskId}/documents/{documentId} | 研究者按个人任务读取冻结 PDF，仍检查任务材料范围与 SHA256 |
| GET /models/probes | `page,pageSize` 分页连接验证及 Advisor 调用历史，含供应商请求/响应 ID、失败类别、用量、结算/预占、核对记录及累计预算；只读，无供应商调用 |
| POST /models/probes/{jobId}/reconcile | `{requestId,inputTokens,outputTokens,providerReference,evidence,verifiedCompleted:true}`；登记至少 5 分钟且尚无用量的未确认请求可凭供应商已确认记录核对；防重与并发锁、审计，禁止改写已结算记录 |
| GET /worker | 活跃 Worker 数、心跳、最近处理、队列长度与等待时间；30 秒未续约即离线 |
| GET /batches | `page,pageSize,q`；按批次名与 configRef 分组，返回人数/条件/状态/任务/模型汇总及不含凭据的 copyPlan |
| GET /catalog | 当前研究、可选任务、Probe 可用性、固定运行方式与默认轮数 |
| GET /overview | 真实参与者/任务状态计数、排队/运行对话作业数、批次；不将会话计作生成作业 |
| GET /codes/export | 按与参与者列表相同的筛选条件导出全部匹配测试码，含条件/批次/北京时间；受管理授权保护 |
| GET /participants | `{items,total,page,pageSize}`，默认每页 20、上限 100；支持 status/condition/batch/q 筛选 |
| GET /participants/{participantId} | 安排元数据、Profile 答案/版本/题目、任务摘要与尝试次数 |
| GET /tasks/{taskId} | 固定目标/顺序/模型引用/冻结配置、场景与全部历史 attempts（含判断、轮次、消息、执行记录、事件） |

`q` 对参与者 UUID 做字面子串查询，或按完整测试码的摘要精确查询。管理列表和详情的 `testCode` 返回当前原码，可重复读取；加密原文和校验摘要不返回。读取接口不返回 test_code_hash、访问凭据或内部 commands 映射。列表不加载全部 task_data；完整历史在任务详情中读取。到期且未完成/未取消的安排以派生状态 expired 展示，不改写原始存储状态。管理读取与参与者授权分离，取消/过期后仍能回放。被管理员取消的尝试保留原状态模型 `status=abandoned, stop_reason=cancelled`，轮次和未完成任务为 cancelled。

`q` 也接受界面显示的 `FCM · XXXXXXXX`（大小写及分隔空白兼容），按其中 UUID 前八位查询。参与记录和测试码导出增加可选 `configRef`（64 位十六进制）与 `unnamed=true` 范围，供批次配置分组精确下钻；未指定时维持原有行为。`GET /health` 保留 HTTP 存活响应，新增独立 `experimentReady` 与 Worker 状态。

- POST /api/v1/admin/settings：`{requestId,revision,environmentName,notes,models:[{id,label,baseUrl,modelName,apiKey?,clearApiKey?}]}`。保存环境元信息与模型连接列表（可为空、最多 50 个；id 唯一），返回与 GET /settings 相同结构。apiKey 省略/null/空串表示保留，clearApiKey=true 删除，二者不能同时提交非空值。Base URL 仅接受 HTTP(S)，禁止内嵌凭据、查询与片段，不在保存时调用外部服务。revision 冲突返回 409，原 requestId/正文重试不重复更新。配置与审计在同一事务提交；原密钥只在专用加密字段保存，不写明文日志、作业摘要或审计。运行信息始终反映实际服务，保存模型配置不会把 runtime.mode 改为真实模型。
- GET /api/v1/admin/advisor-prompts：返回 `{revision,updatedAt,runtimeRef,config,defaults,toolSchemas,runtime}`。config 包含七项 prompt 文本、当前 strategies（id/name/definition/boundary/execution_prompt）和 tools（name/description）；defaults 为文件默认文本，toolSchemas 与 runtime 为只读参数与上限。
- POST /api/v1/admin/advisor-prompts：`{requestId,revision,config}`，返回与 GET 相同的当前配置。保持现行策略 ID 集合与三个工具名，Goal 保留 `{target}`，禁止额外字段及参数结构/额度变更。文本与每次保存的版本、审计同事务持久化；并行 revision 冲突和同编号异文返回 409，同编号原文重试返回当前版本且不重复保存。新模型冻结引用同次读取的运行配置；变化后的新版本需重新验证，既有预览与批次不变。接口不调用供应商，沿用管理授权及 CSRF。
- POST /api/v1/admin/code-preview：{taskCodes,maxTurns,modelId?} → 冻结 configRef 与安排预览。modelId=null/省略为确定性；提供 ID 时冻结所选连接的独立私有工件并返回安全元信息。响应包含 model、runtimeMode、canIssue、readinessMessage；真实模型为 agent，只有相同连接/凭据/运行版本通过 Advisor 验证后创建的新预览 canIssue=true；旧预览不追溯开放。确定性为 deterministic/canIssue=true。中测任务不能发布。
- POST /api/v1/admin/codes：`{requestId,configRef,groups:[{condition:"neutral"或"goal",count}],batchId?,expiresAt?}` → 可重复获取的 codes 与 participant IDs。groups 必填，1–2 项、条件不可重复，每组至少 1、合计最多 1000。
- POST /api/v1/admin/participants/{participantId}/rotate 或 /cancel：{requestId}。

生成安排与审计在一个事务中，实验条件及各组数量严格按研究者指定值创建，不再随机分组。生成请求重试返回原参与者清单及当前已保存的测试码，不创建第二批；换码请求重试不会再次换码，只有该请求对应的访问版本仍为当前版本时返回新码。任务清单、材料、模型引用、条件、目标和选项顺序在创建时固定。开发目标使用明确标识的随机规则，不代表正式客观题目标已审核。

## 执行边界

Worker 从 system_jobs 领取 deterministic_turn、advisor_turn 或 advisor_validation。确定性作业可按固定步骤重启；真实 Advisor 领取/检查点使用短事务，供应商调用在事务外执行。全部署同时最多一个 Advisor；90 秒租约到期后中断，不自动重发。每次调用先官方计数、再按输入和最大输出预占费用；超时、用量不明保留预占。细节见 [Advisor 运行说明](advisor-runtime.md)。

SQLite 用于本地闭环，事务采用 BEGIN IMMEDIATE；PostgreSQL 使用安排行锁与条件唯一索引。提供 PostgreSQL Compose 配置和迁移，但本轮本机无 Docker/PostgreSQL，不能将 SQLite 测试结果声称为 PostgreSQL 并发验收。

管理端所有可读时间及 CSV 采用北京时间；到期输入按 UTC+8 解释。API 时间戳始终携带时区，SQLite 读出的无时区数据库值按 UTC 规范化，避免浏览器将其当成本地时间。测试码使用 HMAC 校验、Fernet 保存可解密原码，迁移为 0002；FCM_SECRET_KEY 与数据库须一并保留。

管理 catalog、预览与任务摘要的 number 来自案例 catalog。底层 taskCode 和个人任务 UUID 保持稳定，不因显示编号变化重建研究记录。

模型连接列表读取会兼容旧版单 model 设置。发码接口继续服务端校验 runtime；未经完整 Advisor 验证的 agent 配置发码返回 409 runtime_not_ready，不创建参与者。真实运行和配置就绪校验见 [Advisor 运行说明](advisor-runtime.md)。
