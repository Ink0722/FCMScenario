# Financial AI Scenarios

`cases/` 是日常使用区；`research/` 保存来源、译文底稿、生成配置和正式核对记录；`tools/` 保存共用程序。历史版本集中到 `archive/`，本地保留但不纳入 Git。

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
