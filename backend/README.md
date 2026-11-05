# 实验后端与研究控制台

当前已实现 FastAPI + Pydantic、SQLAlchemy/Alembic 五表迁移、真实编码与授权、版本化材料、Profile、任务流程、HTTP/SSE 和持久化 Worker。数据库是记录源。对话可按批次选择确定性开发回复，或经过验证的真实 GPT Advisor（现有案例与本地 PDF）。连接验证及全部 Advisor 调用共享累计 $1 上限。详见 [真实 Advisor 运行说明](../docs/advisor-runtime.md)。

研究控制台第一批已实现：研究者登录、总览、预览发码与 CSV 下载、换码/取消、参与者分页筛选、Profile 和全部历史尝试回放。本地使用 Conda FCMScenario / Python 3.12；SQLite 用于开发闭环。PostgreSQL 驱动、JSONB、行锁和 Compose 配置已提供，需在有 PostgreSQL/Docker 的环境执行实际数据库验收。本地材料 Advisor 及独立验证入口已实现；研究 ZIP 导出已提供；正式研究发布、PostgreSQL 并发与部署验收仍需单独完成。Celery/Redis 尚未接入。

## 本地启动

在项目根目录执行：

```bash
conda activate FCMScenario
python -m pip install -r requirements.txt
python -m backend.app.cli init
python -m backend.app.cli issue --tasks task-7k3m --count 1 --output backend/runtime/issued-codes.json
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

`init` 创建受控开发密钥文件并执行迁移，不清空数据库。`issue` 生成新的完整测试安排，测试码以可解密形式保存在数据库，并导出到指定文件；目标文件已存在时停止，避免覆盖。使用 `--condition neutral` 或 `--condition goal` 明确指定实验条件，CLI 默认 neutral。`task-7k3m` 是 Case 01 英文任务，可通过 `--tasks` 安排多个任务；默认上限 20，开发检查可使用 `--max-turns 3`。公开的 FCM-EN 等 Mock 编码不能登录 HTTP 后端。

另开终端，运行 Worker（同时处理确定性和已验证的真实 Advisor）：

```bash
conda activate FCMScenario
python -m backend.app.worker
```

另开终端，运行前端：

```bash
conda activate FCMScenario
cd frontend
VITE_GATEWAY_MODE=http npm run dev
```

打开 http://127.0.0.1:5173 ，使用 `backend/runtime/issued-codes.json` 中的编码。前端 `/api` 代理到 8000；可用 FCM_API_TARGET 指定其他本地地址。未启动 Worker 时消息保存在队列中，刷新仍观察原运行，启动 Worker 后继续。

Worker 每 5 秒登记心跳，30 秒未续约显示离线；正常退出立即登记停止。总览和设置页每 10 秒刷新 Worker、队列积压、最近心跳与处理时间。`GET /api/v1/health` 的 `status=ok` 表示 API/数据库存活，`experimentReady` 单独表示当前可处理实验对话，避免把未启动 Worker 的服务误认为实验可用。

## 研究控制台

同一个 Vite 服务中打开 http://127.0.0.1:5173/admin.html 。管理端始终访问真实后端，即使参与者页面处于 Mock 模式。无需额外安装前端依赖。

本地默认管理口令为 **123456**，直接输入即可，刷新后保持登录。可通过 `FCM_ADMIN_TOKEN` 自定义（至少 6 个字符）；未设置环境变量时读取 `backend/runtime/dev-secrets.json` 的 `admin_token`。无需复制长 Token 或手工设置请求头。

- 批量生成：选择 Neutral、Goal 或“两组分别配置”，填写各组人数，选择任务，在实时汇总中核对并直接生成。可用 10/20/50/100 快捷数量，单批合计最多 1000 个；不再自动分配实验条件。批次名可自填，留空自动生成。成功后保留任务与分组设置，直接继续下一批。
- 配额随机分配：独立入口，按 case 填 Neutral / Goal 任务份数与每人任务数，先保存随机预览，再确认一次发放；每人条件一致、无重复 case，按固定顺序逐项解锁。新版自动均衡各 case、各条件内的 A/B 目标和展示顺序，提供共现矩阵；支持复制新方案、删除未发放预览、归档及恢复已发放方案，归档不撤销测试码。方案历史、配额/序位核对、完成数和当前码 CSV 均可随时查看，重试不重复发放。用法、算法和约束见 [配额随机分配](../docs/quota-allocation.md)。
- 查看与导出：测试码在生成结果、参与记录和详情中随时可见，刷新或重新登录后仍可查看、复制。参与记录可按批次/条件/状态/编号/完整测试码筛选，“导出筛选结果”导出所有匹配页。响应丢失时重试同一请求会恢复已保存的码，不重复生成。
- 换码：保留进度、问卷和历史尝试；旧码、访问凭据与资源票据立即失效。已取消的安排不能靠换码恢复；已过期安排在页面中不允许换码。
- 取消：撤销访问、关闭当前尝试、取消未完成任务和运行；已经保存的数据保留。页面不提供取消已完成安排的操作。
- 设置：左侧“设置”维护环境名称、备注及多个可选模型；每个模型分别保存显示名称、接口 Base URL、模型名和 API Key；刷新后保留。API Key 留空保留原值，填写可替换，也可显式删除；密钥加密保存且不回显。页面同时展示数据库、版本与路径等实际运行信息。保存不会调用外部模型；发放的真实批次使用其冻结连接。
- 草稿保护：设置存在修改时标记“尚未保存”。导航、后退、刷新数据、退出登录均先询问是否放弃；浏览器刷新/关闭触发原生离开提醒。取消后保留内存草稿，密钥不写入浏览器存储。
- 验证记录与核对：设置页下方显示持久化的模型验证请求、供应商请求号、状态、失败类别及预占/结算金额；读取和刷新不调用供应商。用量不明且登记满 5 分钟的请求，研究者可在供应商确认结束后，填写用量、记录/工单编号及依据进行一次性核对。保留原始请求、人工核对记录与审计，同编号重试不重复结算，不能修改已结算用量，不提供预算清零/提额入口。核对依赖研究者如实输入供应商已确认的数据，无法确认时应保留预占。
- 批次管理：按批次名与冻结配置分别汇总人数、Neutral/Goal 数量、任务、模型及完成进度。同名但不同配置不会混在一起。查看参与记录、导出测试码均保留该配置范围；“复制配置”只预填新发放表单，保留人数/任务/轮数、重新确认当前模型，不复制原截止时间或访问凭据，不改写旧记录。
- GPT 预设：运行 `python -m backend.app.cli configure-openai` 追加 GPT-5.4 mini 固定版本。设置页选择“GPT-5.4 mini（联调）”，填写 API Key 并保存后可点击“验证连接”。额度累计 $1，跨保存/模型/重启保留；请求前预占、有效用量后结算，结果不明保留预占、不自动重发。未提供真实 Key 时不产生费用。验证范围、额度与失败恢复见 [Advisor 运行说明](../docs/advisor-runtime.md)。
- 整批模型选择：发码页默认“不使用模型”，确定性回复可直接发放；选注册模型时为整批统一选择。设置中通过“验证 Advisor”后，新预览可发放本地材料联调批次。未验证或旧预览仍被阻止，不会替换成确定性回复。验证绑定连接、密钥和 Prompt/工具版本。旧版单模型配置自动兼容，已冻结的模型连接版本不受后续编辑/移除影响。运行协议和验证要求见 [Advisor 运行说明](../docs/advisor-runtime.md)。
- 任务编号：管理端统一显示案例两位数 `01`–`20`，任务选择采用紧凑数字网格，不另显示随机 TASK 编号；底层稳定任务 ID 和既有记录保持一致。
- 研究导出：参与记录提供“导出研究数据 ZIP”，包含判断、全部历史尝试、策略、对话、工具、Token 与费用；沿用列表筛选，空值与 0 分开，开发配置和异常单独标记。说明见 [研究导出](../docs/research-data-export.md)。
- 回放：参与记录 → 参与者 → 任务 → 切换历史尝试。显示初始/最终判断（包括 0 信心度）、消息、运行状态、事件和原始 JSON。回放只读，不重新调用 Worker 或模型；未产生的模型、工具和策略记录明确显示为空。

页面、到期时间输入和测试码导出统一使用北京时间（Asia/Shanghai，UTC+8），不跟随浏览器时区；数据库和 API 的原始时间使用明确时区的 UTC。测试码的校验摘要与加密原码分别存储，只有管理接口返回原码；加密使用 [Fernet](https://cryptography.io/en/stable/fernet/)，密钥由服务端 FCM_SECRET_KEY 分用途派生。迁移 0002 增加原码存储字段，初始化会升级到最新迁移。

浏览器使用 8 小时的 HttpOnly / SameSite=Strict 会话 Cookie，HTTPS 时带 Secure；Cookie 路径限于管理 API。环境设置作为 `system_jobs.kind=environment_settings` 的单一配置记录保存，变更带版本校验、防重及审计；模型密钥使用与测试码不同用途的派生密钥加密，不需要增加数据表或迁移。会话作为 `system_jobs.kind=admin_session` 的控制记录保存，退出、重新登录或口令轮换可使其失效，不计入对话作业数。写操作还验证 CSRF 与请求来源。CLI 的 Bearer 管理凭证继续可用。反向代理须保留原始 Host，HTTPS 代理需正确传递并配置可信代理协议头。生产构建同时输出 `index.html` 和 `admin.html`，服务端应同源代理 `/api`；不需要给哈希路由配置服务端路由回退。

`runtime/` 已被 Git 忽略，包含 SQLite、开发密钥、冻结配置和 PDF。备份需同时保留数据库、工件和所用密钥。不要将 runtime、cases 或 research 挂成公开静态目录。资源票据出现在受控 PDF 的查询参数中，API 示例使用 `--no-access-log`，不记录完整 URL。

## 流程与数据约定

- participants 保存一次 Profile，participant_tasks 保存整次测试安排，tasks 保存个人任务及 attempts/turns。另有 admin_audit_logs、system_jobs。
- 每码条件一致，每项模型引用、目标和选项顺序固定。当前配置是开发规则，不宣称正式客观题目标已审核。
- Session.id 即 attempt_id；刷新恢复原尝试，确认退出保留原始记录并在重做时新建 attempt。
- Profile 提交后可开始任务；前测和最终判断均为 A/B+0–100 整数置信度，额外后测和中测关闭。
- 至少 3 轮后可主动结束；默认第 20 轮完整保存后进入最终判断。所有分配任务成功完成后整次测试才完成。
- 命令幂等、安排行锁/SQLite 写事务和条件唯一索引保护并发；已保存答案不能通过新请求 ID 改写。
- 真实 Advisor 在事务外调用，短事务领取及保存检查点；全部署串行执行，90 秒租约。过期运行中断且不自动重发，供应商用量未确认时保留费用预占。取消后迟到记录归属旧尝试，不能推进新尝试。

完整字段、路径、错误和 SSE 约定见 [HTTP 协议](../docs/http-protocol.md)。API 运行后可查看 http://127.0.0.1:8000/docs 。管理凭证不进入参与者前端。

## PostgreSQL Compose

将 backend/.env.example 复制为被忽略的 backend/.env，设置长随机 FCM_DB_PASSWORD、FCM_SECRET_KEY、FCM_ADMIN_TOKEN。数据库密码使用 URL 安全字符。

```bash
docker compose --env-file backend/.env up --build
docker compose --env-file backend/.env exec api python -m backend.app.cli issue --tasks task-7k3m --count 1 --output backend/runtime/issued-codes.json
docker compose --env-file backend/.env cp api:/app/backend/runtime/issued-codes.json backend/runtime/compose-issued-codes.json
```

Compose 启动 PostgreSQL、API 和 Worker，8000 只绑定本机，数据库与工件分别持久化。前端仍按上文启动；HTTPS、域名和正式部署验收尚未完成。当前机器没有 Docker/PostgreSQL，因此此配置尚未在本机运行验证。

## 验证

```bash
conda activate FCMScenario
python -m pytest backend/tests -q
python -m unittest discover -s tools/tests -v
python tools/check_project.py
cd frontend
npm test
npm run build
npm run test:e2e
npm run test:e2e -- --config playwright.http.config.ts
```

HTTP 浏览器测试使用独立数据库、8001/5174 端口和测试编码，不触碰本地开发数据库。服务启动和测试 Worker 都通过 `tools/run_python.py` 选择解释器，支持 `FCM_PYTHON`，或使用已激活的 Conda / 当前 Python 3.12+。生产构建默认 HTTP，排除公开材料和 Mock 编码；开发模式默认保留原 Mock 便于既有页面检查。
