# Financial AI Scenarios

本项目包含金融决策案例、实验桌面前端、Python 实验后端、研究控制台与材料工具。当前正式案例暂为空，新的文献候选和审核记录保存在 research/candidates/；通过审核后再进入 cases/。后端实验流程、发码和 Advisor 接口保留，详见 docs/advisor-runtime.md。

## 从哪里开始

- [内容维护指南](docs/content-maintenance.md)：更新习题、案例、PDF、Profile 和实验任务。
- [项目结构与后端边界](docs/architecture.md)：目录职责与 Case／Task／Session 区分。
- [前端说明](frontend/README.md)：页面流程、本地运行与当前限制。
- [案例编辑入口](cases/README.md)：新 YAML 与旧 Markdown 的双格式过渡。
- [数据契约](contracts/README.md)：前后端中立 Schema 与生成类型。
- [后端运行说明](backend/README.md)：数据库初始化、发码、API/Worker 启动与 HTTP 联调。
- [HTTP 协议](docs/http-protocol.md)：认证、命令防重、SSE 与恢复状态。

## 本地运行

```bash
conda activate FCMScenario
python -m pip install -r requirements.txt
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ ，本地 Mock 当前使用 FCM-EMPTY 检查入口、Profile 和空任务提示。新案例接入后，开发编码和任务会随配置重新生成。HTTP 模式按 backend/README.md 启动，使用服务端生成的新码。

研究控制台入口为 http://127.0.0.1:5173/admin.html ，始终接真实后端；支持研究者登录、发码/CSV/换码/取消、参与记录筛选和全部历史尝试回放。登录方式见 [研究控制台说明](backend/README.md#研究控制台)。

Python 依赖统一维护在根目录 `requirements.txt`，涵盖后端、内容工具和自动测试，要求 Python 3.12+。本地激活 Conda `FCMScenario` 后安装依赖；npm 和 HTTP 浏览器测试共用 `tools/run_python.py`。解释器按 `FCM_PYTHON`、已激活的 Conda、当前 Python 3.12+ 的顺序选择，显式配置无效时直接提示，不使用已移除的项目虚拟环境。

## 修改案例

候选阶段先编辑 research/candidates/<slug>/，不要提前把草稿登记成正式案例。通过 Ground Truth 审核后，再创建英文 case.en.yaml、登记 cases/catalog.yaml，并在 studies/ 配置 Task。具体输入格式和校验命令见 docs/content-maintenance.md 与 docs/case-authoring.md。

旧 20 个案例已移出当前工作树，完整版本保存在 Git 标签 legacy-20-cases。

## 目录职责

| 目录 | 维护内容 |
| --- | --- |
| frontend/ | 页面与交互、固定 UI 文案、Gateway 适配 |
| backend/ | 实验 API、数据库迁移、可选 Advisor Worker 与集成测试 |
| cases/ | 已审核的参与者案例与稳定目录入口；当前暂为空 |
| shared/ | 公共说明、测量提示和独立 Profile |
| studies/ | 实验任务配置；fixtures 仅为本地开发编码 |
| contracts/ | 案例、问卷、实验与运行数据 Schema，生成 DTO |
| research/ | 候选来源、Ground Truth、译审与审核记录；不进入参与者 DTO |
| tools/ | 校验、同步、打包、PDF 与类型生成 |
| docs/ | 架构和维护指南 |
| build/ | 生成和核对产物，不作为编辑源 |

HTTP 模式中的参与记录、测试码绑定、作答和完成状态由后端存储，不放入案例。研究者资料不导出到参与者材料；正式生产部署仍需后续验收。

## 验证

```bash
python -m unittest discover -s tools/tests -v
python3 tools/check_project.py
cd frontend
npm test
npm run build
npm run test:e2e
```

## 当前案例状态

当前没有已发布的正式案例。下一案例完成审核后，按 cases/README.md 登记并重新编译前端。旧 20 个案例可通过 Git 标签 legacy-20-cases 恢复到临时工作树。
