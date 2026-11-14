# 内容维护指南

## 首次准备

在项目根目录执行，使用 Python 3.12 的 Conda 环境：

```bash
conda activate FCMScenario
python -m pip install -r requirements.txt
```

后端、内容工具与自动测试共用根目录 `requirements.txt`，要求 Python 3.12+。本地统一使用 Conda `FCMScenario`，npm 和 HTTP 浏览器测试通过 `tools/run_python.py` 选择解释器：显式 `FCM_PYTHON` 优先，其次为已激活的 Conda，最后为当前 Python 3.12+。无效配置和过低版本会明确报错。

不激活 Conda 时，可以通过统一入口显式指定已安装相同依赖的解释器：

```bash
FCM_PYTHON=/path/to/python3.12 python3 tools/run_python.py tools/check_content.py
```

路径可包含空格，设置变量时按终端规则加引号；不要把本机路径写入项目源文件。

## 快速定位

| 要修改什么 | 编辑源 |
| --- | --- |
| 已审核 case 的题干、背景、条件、比较信息、术语 | `cases/对应目录/case.en.yaml`；候选阶段先编辑 `research/candidates/` |
| FinDRIFT 新案例的生成流程 | `docs/case-authoring.md` |
| FinDRIFT 新案例的来源、原始任务与适配记录 | `research/templates/notes.md` |
| FinDRIFT 新案例的 Ground Truth、taxonomy、来源与审核 | `research/templates/case.yaml` 及对应研究者记录 |
| 当前案例清单与语言 | `cases/catalog.yaml` |
| 某项实验开放哪些任务、引用哪个 case | `studies/local-development.yaml` 或其他实验 YAML |
| 本地测试码对应哪些任务 | `studies/fixtures/local-codes.yaml`，仅开发用 |
| 公共英文说明、判断与置信度提示 | `shared/copy/en.yaml` |
| 原中文公共说明 | `shared/instructions.md`；修改后需复核英文译稿的 source_revision |
| Profile 题项 | `shared/questionnaires/profile.zh-CN.yaml`；本轮仍是原开发题项 |
| 页面按钮、状态、颜色和布局 | `frontend/src/app/copy.ts`、`styles.css` 及页面组件 |
| PDF 内容 | 对应案例 `latex/`，使用原 PDF 编译工具 |
| 答案、评分、原始来源、译审依据 | `research/`；原 notes.md 暂保留原路径 |

## 修改一个正式案例

正式案例必须先通过研究审核，再进入 cases/。修改参与者可见文字、选项或文件时，同时更新审核记录和版本说明，并运行完整内容检查。旧 20 个案例已从当前分支移除；如需审计，使用 git worktree add /tmp/fcm-legacy legacy-20-cases 创建临时副本。

## 添加 FinDRIFT 新案例

FinDRIFT 新案例采用文献驱动、保真优先、one-by-one 流程，完整规范见 [FinDRIFT Case Authoring](case-authoring.md)。

1. 先选择一篇可核验的实证文献，并定位具体 Experiment、原始任务说明、选项和刺激材料；
2. 判断原始任务是否自然支持客观 A/B 决策。原始任务不是二分类时，不得机械转换；如果必须大幅改写才能形成稳定答案，放弃该候选；
3. 用 research/templates/notes.md 记录文献来源、实验位置、原始任务、材料可获得程度、保真判断和逐项适配记录；
4. 用 research/templates/case.yaml 完成研究者侧 taxonomy、reference answer、decision rule、required facts、derivation、source evidence 和 assumptions；
5. Ground Truth 通过人工审核后，才在 cases/ 中建立新目录并创建英文 participant-facing case.en.yaml；新案例不生成中文副本；
6. 原始论文、补充材料和 Ground Truth 证据默认保存在 research/<case_id>/sources/，不自动放入参与者可见的 references；
7. 在 cases/catalog.yaml 登记稳定 case_id、scenario_id、目录和 en 语言入口；新 case 使用 legacy_mode: none，不要求创建旧 Markdown；
8. 在 studies/对应实验.yaml 的 tasks 中引用 case_id，使用独立稳定任务编号；
9. 运行内容检查、材料编译和前端验证。

不预设 A×B 单元格生产任务或案例数量。taxonomy 在候选通过来源、客观性和 Ground Truth 审核后再标注。旧 20 个案例不属于当前生产范围；如需查阅，只从 Git 标签恢复临时副本，不复制回当前工作树。

## 添加英文版本

1. 原案例的英文版与中文版使用同一 case_id 和稳定选项／比较项 ID；不要把中文内容标记为 en。
2. 未提供经译审的英文内容时不创建假英文副本。
3. 新增英文语言可以用 `legacy_mode: none`，不要求另建旧 Markdown；原中文 verify 配对继续保留。
4. 在实验配置中明确指定案例语言。`case_locale` 指定实验默认案例语言，可用 `case_locales` 按案例明确覆盖；所有引用任务都必须具有所指定的语言。

当前本地配置使用英文 UI；正式案例接入时在实验 YAML 中明确指定 case_locale: en。当前本地开发编码为 FCM-EMPTY，用于检查没有正式案例时的入口状态。正式案例接入后，编译器只导出实验 tasks 引用且语言已经审核的材料。程序不会静默回退语言。未纳入当前实验的已登记案例不会自动开放给参与者；前端打包只包含该实验 tasks 引用的案例。

## 输入格式说明

case.schema.json 定义所有允许字段，未知字段会报错。案例不包含 Profile、答案、Goal、参与者编码或作答。

- options 必须各有一个 A 和 B；comparison.values 按选项身份存储，与显示位置无关。
- 金额、费率、日期、限制与例外作为完整原文字符串保存，避免自动解析导致单位或精度变化。
- 背景及补充正文可用 YAML 的多行格式，正文支持 Markdown。common_facts、comparison、additional_information、references 和 knowledge 没有对应内容时可以写 []，不要编造内容填充模板。
- references 只保存参与者确实需要打开的文件；原始论文、补充材料和 Ground Truth 证据默认保存在研究者侧 sources 目录。访问 URL、文件哈希与材料 revision 由工具生成。
- 同一列表中的稳定 ID 必须唯一。复制输入时保留案例身份，新增案例时分配新身份。
- 重复 YAML 键、缺字段、错误类型、缺文件、路径越界、选项不完整都会阻止打包。

## 重新生成与验证

```bash
# 所有案例语言、共享内容、配置和契约
python tools/check_content.py
# 所有旧格式配对及结构化输入
python tools/cases.py check
# 原 PDF/LaTeX、链接与来源哈希，兼容原命令
python3 tools/check_project.py
# 导出一个案例的运行输入，不改源文件
python tools/cases.py export --case 01 --locale zh-CN
# 生成当前本地前端材料与开发配置
python tools/prepare_frontend.py
```

其他实验可以通过 `--study studies/文件.yaml` 选择。npm 默认读取 local-development；需要切换 npm 构建使用的实验时，设置 `FCM_STUDY_FILE`。用于本地 Mock 的方案应显式指定自己的 `development_codes` 开发夹具。正式后端不使用这个公开夹具认证。

```bash
cd frontend
npm run materials
npm run build
npm test
npm run test:e2e
```

修改之后新任务使用新快照，已开始任务继续使用旧内容。页面无需重做；正式部署仍需重新构建并发布相应资源。

## PDF 仍按原方式维护

原 LaTeX 和 PDF 均保留原位置，不自动搬动或重写。

```bash
python3 tools/build_pdfs.py --document 14-02
python3 tools/build_pdfs.py 14
python3 tools/build_pdfs.py --check
```

需要原有 XeLaTeX 与字体环境。编译成功不代表金融内容和译文已经核对；编译后仍需文本与目视核验，研究 QA 记录按原规则维护。草稿生成工具仍只写入 build/drafts，不覆盖正式源文件。
