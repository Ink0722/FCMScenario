# Financial AI Scenarios

## 实验前端初版

`frontend/` 提供 React + TypeScript 的桌面实验界面，复用本项目材料与 PDF。输入测试编码后进入任务列表，最上方是只需填写一次的用户资料任务，完成后选择所分配的测试任务，每个任务使用独立编号；开始后固定任务，刷新恢复已提交进度，完成后可以返回列表。返回主界面前需确认，确认后丢弃未完成进度，保留编码并返回任务选择页。支持阅读与 Pre 合并、对话、可选 Probe、Post 与完成流程；用户资料独立于任务，按编码保存。Pre/Dialogue/Post 均为双栏，材料在左、决策任务在右；参与者界面不含预览或模拟提示。后端接口暂未接入，本地检查可输入 `FCM-2026` 查看三个任务。启动、材料更新与接口边界见 [frontend/README.md](frontend/README.md)。

`cases/` 是日常使用区；`research/` 保存来源、译文底稿、生成配置和正式核对记录；`tools/` 保存共用程序；`shared/` 保存全局实验文案。历史版本集中到 `archive/`，本地保留但不纳入 Git。

## 修改参与者材料

各案例的 `material.md` 是该案例网页内容的唯一编辑源；[shared/instructions.md](shared/instructions.md) 是公共实验说明、选择题干、置信度题干和各阶段提示语的唯一编辑源。材料保留三部分：场景信息、背景知识、决策选项。Notes、原始来源、研究者答案和 Goal 不进入材料导出。

直接编辑 Markdown 正文。文件首行的 `material-meta` 记录案例身份、结构版本及展示模板（`table` 或 `cards`）。`block` 注释标识背景、共同条件、A/B资料、补充资料、PDF入口、任务、背景知识及决策选项。注释不属于参与者文案；可修改中文标题，读取程序不以中文标题或章节编号定位内容。保留区块标识及其顺序。

A/B资料统一使用“属性／方案A／方案B”三列表格；前端按 `template` 将同一组属性排成比较表或对称卡片。两列保持字段相同、顺序相同；相同条件集中在共同条件中，不能将未提供的条件写成“无”。列头固定为`属性`、`方案A`、`方案B`。表格内每个字段占一行，单元格中不用换行或竖线`|`；较长收费表和合同条款放入补充资料，不摘要、不省略资格和例外。调查、历史记录及条款通过 `information` 标识独立成块。参考文件只链接本案当前PDF，不手写页数。

```bash
# 校验20份材料、公共说明、A/B结构和42个PDF入口
python3 tools/materials.py --check

# 从文件读取并输出01的完整内容数据；不改变源文件
python3 tools/materials.py --case 01

# 可选：生成供前端接入的完整快照；build/已被Git忽略
python3 tools/materials.py --output build/materials.json
```

`tools/materials.py` 仅提供读取、校验与数据导出，没有实现网页。前端接入时应读取或监听源文件；若使用导出JSON，需要在Markdown变化后重新生成。JSON是派生快照，不是第二份手工维护的材料。静态部署需要重新构建和发布；修改本地文件不会自动改变已部署的网站。

数据接口顶层为 `schema_version`、`shared`、`scenarios`。每个Scenario包含：

| 字段 | 内容 |
|---|---|
| `case_id` / `scenario_id` / `title` / `template` | 身份、标题及两类展示模板 |
| `background` | 决策情境原文 |
| `common_facts[]` | 共同条件；段落和原有Markdown表格完整保留 |
| `comparison[]` | 每行含 `attribute`、`A`、`B`，同一份属性用于表格或卡片 |
| `additional_information[]` | `kind`、`title`、`text`；收费及合同条款、调查和历史资料 |
| `references[]` | 本案当前PDF的编号、名称和项目相对路径 |
| `task` | 决策任务 |
| `knowledge[]` | 金融术语标题及解释 |
| `options[]` | `id`、`label`；只维护一处A/B名称，方案展示与三次决策复用 |
| `source_file` / `revision` | 编辑来源及文件SHA-256，用于材料版本识别 |

正文数据保留Markdown，需要前端按Markdown显示；比较资料已经拆成字段，不需要前端再猜测A/B边界。读取规则不会生成 AI 总结、计算推荐答案或预填参与者结果。

阅读与Pre、Dialogue、Post必须使用同一个Scenario对象，保留背景、共同条件、比较资料、全部补充资料、背景知识、任务及PDF入口。材料展示在左栏，决策任务统一放在右栏；只允许重排布局，不因栏目名称为“补充资料”而默认排除条款。`options`供选择组件和方案名称使用，不把作答控件或任何历史答案显示在Dialogue左栏。置信度为必填整数0—100，默认值为null；Pre、Probe、Post题干从共享文件读取，三者复用同一组A/B选项。每次实验开始时冻结该Scenario和共享文案的 `revision`；文件修改供新实验使用，进行中的实验继续使用开始时的内容。

公共说明在编码入口和任务选择页统一呈现，进入Scenario后直接展示材料，Dialogue左栏也不重复说明。两个入口页的说明仍从 `shared/instructions.md` 导出。公共说明文件中的选择及置信度题干分别供决策组件使用，不能将整个共享文件一次性显示在左栏。题干不包含答案字段；参与者响应由实验程序另行存储。

## 修改 PDF

每份 PDF 在案例目录的 `latex/` 中都有一份同名 `.tex`。该文件是正式编辑源，编译程序只读取它，不会用译文底稿覆盖你的修改。

需要 XeLaTeX，以及源文件中使用的宋体（当前使用 macOS 自带 Songti）和 TeX Gyre Termes 字体。以下命令在项目根目录执行：

```bash
# 编辑 cases/14_Loan_Pause/latex/14-02_失业延期还款申请.tex 后，更新这份 PDF
python3 tools/build_pdfs.py --document 14-02

# 更新某个案例的全部 PDF
python3 tools/build_pdfs.py 14

# 编译检查全部 42 份源文件，结果写入 build/，不替换正式 PDF
python3 tools/build_pdfs.py --check
```

正式 PDF 输出到案例目录；编译检查和临时文件放在 `build/`。从原始译文和排版规则重新生成时，使用 `python3 tools/generate_drafts.py 14`；01 同样使用 `python3 tools/generate_drafts.py 1`。草稿只写入 `build/drafts/`，不会覆盖正式 `.tex` 或 PDF。核对后如要采用草稿，手工替换相应正式源文件，再编译。

修改金融事实时，同步维护 Material、Notes 和研究底稿；仅修改字号、列宽或标题格式时，编辑 `.tex` 即可。

## 核对

```bash
python3 tools/check_project.py
swift -module-cache-path /tmp/fcm-swift-cache tools/check_case_documents.swift
python3 tools/audit_case_documents.py
```

后两步需要 macOS PDFKit，检查输出位于 `build/pdf_qa/`。`research/NN/qa/` 中保留正式核对记录。手工改变 PDF 内容后，原记录先标记为待复核；不得把编译成功等同于内容核对成功。

## Git 忽略范围

只忽略根目录及任意位置的 `archive/`、根目录 `build/` 与 `tmp/`、Python 缓存、LaTeX 编译中间文件及 `.DS_Store`。当前 PDF、正式 `.tex`、Material、Notes、原始来源、译文底稿、配置、程序和正式核对记录继续纳入 Git。不笼统忽略 PDF、JSON、图片或整个 `research/`。

## 案例

| 编号 | 案例目录 | 决策主题 | PDF 数量 |
|---|---|---|---|
| 01 | [01_Fund_Shares](cases/01_Fund_Shares/) | 基金份额选择：八年持有 | 1 |
| 02 | [02_Annuity_Switch](cases/02_Annuity_Switch/) | 年金合同替换：四年持有 | 1 |
| 03 | [03_Retirement_Rollover](cases/03_Retirement_Rollover/) | 退休账户转移：五年持有与两层费用 | 2 |
| 04 | [04_UIT_Switch](cases/04_UIT_Switch/) | UIT持仓安排：保留旧一期或合并购买新一期 | 1 |
| 05 | [05_Account_Fees](cases/05_Account_Fees/) | 账户收费方式：一年交易安排 | 2 |
| 06 | [06_CD_Liquidity](cases/06_CD_Liquidity/) | 存款办理渠道选择：六个月后的付款安排 | 2 |
| 07 | [07_Student_Refinance](cases/07_Student_Refinance/) | 学生贷款再融资：选择合并范围 | 3 |
| 08 | [08_Overdraft](cases/08_Overdraft/) | 日常账户透支设置：账单与临时支付 | 2 |
| 09 | [09_Promo_Financing](cases/09_Promo_Financing/) | 消费融资选择：较长优惠期与不同计息规则 | 4 |
| 10 | [10_Credit_Monitoring](cases/10_Credit_Monitoring/) | 信用资料保护：是否增加付费监测 | 3 |
| 11 | [11_Mortgage_Points](cases/11_Mortgage_Points/) | 房贷报价选择：四年后结清的费用安排 | 2 |
| 12 | [12_Mortgage_Payments](cases/12_Mortgage_Payments/) | 房贷还款渠道：双周扣款与本金入账 | 2 |
| 13 | [13_Auto_Insurance](cases/13_Auto_Insurance/) | 汽车贷款保险：已有保单与新增保障记录 | 2 |
| 14 | [14_Loan_Pause](cases/14_Loan_Pause/) | 教育贷款暂停还款：资格与利息安排 | 2 |
| 15 | [15_GAP_Coverage](cases/15_GAP_Coverage/) | 汽车贷款：是否加入余额差额保障 | 2 |
| 16 | [16_Auto_Investing](cases/16_Auto_Investing/) | 投资账户：自动管理还是自行管理 | 2 |
| 17 | [17_Mortgage_Rates](cases/17_Mortgage_Rates/) | 住房贷款：固定月供还是先固定后浮动 | 2 |
| 18 | [18_Card_Rewards](cases/18_Card_Rewards/) | 信用卡奖励：统一返现还是分类积分 | 3 |
| 19 | [19_Debt_Consolidation](cases/19_Debt_Consolidation/) | 信用卡欠款：合并贷款还是保留分卡还款 | 2 |
| 20 | [20_Cash_Options](cases/20_Cash_Options/) | 现金账户：银行存款还是政府货币基金 | 2 |
