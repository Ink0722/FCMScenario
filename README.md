# Financial AI Scenarios

本项目包含金融决策案例、实验桌面前端与材料工具，后端目录已预留。现有 20 个案例已增加结构化 YAML，原 Markdown、Notes、42 份 PDF 和正式 LaTeX 全部保留原位置。

## 从哪里开始

- [内容维护指南](docs/content-maintenance.md)：更新习题、案例、PDF、Profile 和实验任务。
- [项目结构与后端边界](docs/architecture.md)：目录职责与 Case／Task／Session 区分。
- [前端说明](frontend/README.md)：页面流程、本地运行与当前限制。
- [案例编辑入口](cases/README.md)：新 YAML 与旧 Markdown 的双格式过渡。
- [数据契约](contracts/README.md)：前后端中立 Schema 与生成类型。
- [后端接入目录](backend/README.md)：后续实现位置；当前尚无真实服务。

## 本地运行

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-tools.lock.txt
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ ，本地开发码 FCM-2026 对应三项任务，FCM-ALL 对应全部 20 个案例。当前仍为本地 Mock，尚未部署或接入正式 Agent。

## 修改案例

推荐编辑 `cases/对应目录/case.zh-CN.yaml`，然后明确同步保留的 Markdown：

```bash
.venv/bin/python tools/cases.py sync --case 01 --from yaml
.venv/bin/python tools/check_content.py
```

也可以继续编辑原 `material.md`，再执行 `--from markdown`。两边不一致时构建会停止，不自动覆盖；现有文件格式继续保留。新增英文内容由负责人译审，不把中文副本标为 en。

## 目录职责

| 目录 | 维护内容 |
| --- | --- |
| frontend/ | 页面与交互、固定 UI 文案、Gateway 适配 |
| backend/ | 后续后端代码与迁移、测试骨架 |
| cases/ | 参与者案例与稳定目录入口，保留旧格式 |
| shared/ | 公共说明、测量提示和独立 Profile |
| studies/ | 实验任务配置；fixtures 仅为本地开发编码 |
| contracts/ | 案例、问卷、实验与运行数据 Schema，生成 DTO |
| research/ | 来源、译审、答案与核对；旧索引继续兼容 PDF 工具 |
| tools/ | 校验、同步、打包、PDF 与类型生成 |
| docs/ | 架构和维护指南 |
| build/ | 生成和核对产物，不作为编辑源 |

真实参与者、测试码绑定、作答和完成状态由未来后端存储，不放入案例。研究者资料不导出到参与者材料；正式服务还需实现访问控制与持久化。

## 验证

```bash
.venv/bin/python -m unittest discover -s tools/tests -v
python3 tools/check_project.py
cd frontend
npm test
npm run build
npm run test:e2e
```

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
