# Case 01 英文网页译文核对记录

日期：2026-10-17。

## 文件和范围

- 中文结构化源：`cases/01_Fund_Shares/case.zh-CN.yaml`。
- 英文网页：`cases/01_Fund_Shares/case.en.yaml`。
- 中文 YAML、原 material.md、Notes、PDF 和 LaTeX 全部保留。
- PDF 按用户要求暂不翻译；英文链接标题仍指向原 PDF，document_id 不变。
- 此记录放在 research/，不发布给参与者。

## 核对要点

| 原文信息 | 英文处理 |
| --- | --- |
| 新投资 40,000 美元 | $40,000，币种与金额不变 |
| 另有同系列持仓 20,000 美元，本次不出售 | $20,000，保留不出售、可合并及已核验条件 |
| 持有整八年，期末全部赎回 | exactly eight years，保留不追加、不提前或分批赎回、不转换份额 |
| A/B 不可分拆投入 | 完整保留；两种份额对称翻译为 Share class A/B |
| 账户、身份、服务、交易、到账、税务条件 | 分别保留；没有引入收益率或账户类型假设 |
| 不使用未来购买意向书；不适用两项费用豁免 | 分别保留 letter of intent、purchase sales charge 和 deferred sales charge 的限制 |
| A 的累计折扣资格已确认 | 保留，不把它改写成应选择 A 的结论 |
| 本渠道仅可购买 A/B | 保留 |
| MX01 / MX02 | 原值和 A/B 对应关系不变 |
| 决策目标 | 以本次新投资八年期末的净经济价值比较；不添加评分、答案或建议 |
| 三条背景知识 | 逐项译为基金份额、费用、持仓合并折扣，未增加金融事实 |

英文版与中文版共用 case_id、scenario_id、选项 ID、比较项 ID、术语 ID 和 document_id；locale 与内容 revision 分开。英文使用 legacy_mode: none，不覆盖中文旧格式配对。

## 本地启用

`studies/local-development.yaml` 中显式指定 `case_locales: {'01': en}`；其他案例继续使用 zh-CN。`FCM-EN` 只包含 Case 01 对应任务。已经开始的会话保留原快照，返回列表重新开始或使用新编码可查看新版。

## 本次版本校对记录

- 中文 YAML SHA-256：`0f846293b79a997c95033ced50b86b27a757f385a40833dd98c8ef0cef98a866`
- 英文 YAML SHA-256：`d372264cc4954ea75308c201b62f954ebf146af97b7af8730cfd771849cef331`

更新中文案例后应同步复核英文；这两种语言不会自动互相改写。
