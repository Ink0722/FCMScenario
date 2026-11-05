# FinDRIFT Case Authoring

本页是 FCMScenario 中新增 FinDRIFT Scenario 的执行规范。研究设计以当前 FinDRIFT 方法页为准；本文件只把已确定原则转成仓库内可执行流程。

## 1. 当前范围

FinDRIFT 核心 Benchmark 只纳入**客观可判定（objectively evaluable）**的 A/B 个人金融决策。

每个正式 Scenario 必须满足：

1. 有明确的 A/B 核心决策；
2. 给定事实和约束后存在可复核的 reference answer；
3. 答案可由计算、合同条款、资格规则、监管要求或其他明确依据推导；
4. 推导答案所需的关键事实已经提供；
5. 结论不依赖未观测的个人偏好、效用函数或未设定的未来状态。

参与者可见内容继续使用现有 `contracts/schemas/case.schema.json` 和 `contracts/examples/case.example.yaml`。答案、Goal、taxonomy、推导与研究者审核信息不得写入 participant-facing case。

## 2. Taxonomy

### Axis A — Primary Financial Decision Domain

- A1 Budgeting
- A2 Managing Income and Expenditure
- A3 Saving
- A4 Investment
- A5 Long-term Planning and Asset Building
- A6 Retirement
- A7 Credit
- A8 Debt and Debt Management

Primary A 由“用户最终在决定什么”确定。

### Axis B — Primary Decision Challenge

- B1 Cost, Terms & Contract Evaluation
- B2 Risk & Uncertainty Evaluation
- B3 Rules, Rights & Protection Evaluation
- B4 Information & External Context Evaluation

Primary B 由“Ground Truth 最依赖哪一类判断”确定。若同时涉及多个 challenge，只选最具决定性的一个，其余作为 secondary metadata / tags。

## 3. Pilot：先做 A1–A8 × B2

当前预实验先从 Axis B 的 **B2 Risk & Uncertainty Evaluation** 开始，逐个尝试 A1–A8。

B2 必须满足额外约束：**正确答案不能建立在用户个人风险偏好上。** 不得以“更稳妥”“更适合风险厌恶者”“更愿意承担风险”等未观测偏好直接决定 reference answer。

可接受的客观化方式包括：给定最大损失或资金缺口阈值、最低保障要求、明确概率与损失、既定流动性约束、明确风险覆盖标准等。应满足：

```
Facts + explicit risk criterion -> reproducible reference answer
```

而不是：

```
Facts + unknown personal risk preference -> choice
```

## 4. One-by-one 工作流

每次只处理一个 A × B 组合。不要一次批量生成多个正式案例。

### Step 1 — Case Concept

先提出一个候选构思，只回答：

- 现实中的核心金融决策是什么；
- 为什么 Primary A 属于目标 Domain；
- 为什么 Primary B 是目标 Challenge；
- Ground Truth 如何可能成立；
- 需要哪些可核验来源。

此阶段**不要创建 participant YAML**。

### Step 2 — Taxonomy & Feasibility Check

检查：

- A 是否由最终决策对象决定，而不是由产品名称决定；
- B 是否真的是 Ground Truth 的主要判断来源；
- 是否存在隐藏偏好、未给定未来状态或其他导致答案不唯一的问题。

若不能自然满足，停止当前构思并重新设计；不要为了填矩阵硬改标签。

### Step 3 — Source Verification

优先使用官方合同、费用披露、监管文件、政府/机构规则或其他一手资料。不得编造条款、概率、数字、来源或审核结果。

### Step 4 — Ground Truth First

先按 `research/templates/case.yaml` 填写研究者侧材料，至少完成 reference answer、decision rule、required facts、derivation、source evidence 和 assumptions。

Ground Truth 未通过人工审核前，不进入正式 participant material 编写。

### Step 5 — Participant-facing Case

Ground Truth 通过后，才按照 `contracts/examples/case.example.yaml` 创建 `case.zh-CN.yaml`。参与者材料保持中性、A/B 对称，不泄露答案、Goal、taxonomy 或研究者推导。

### Step 6 — Validation & Human Review

至少检查：

- A/B 是否真实可执行；
- 关键信息是否完整；
- reference answer 是否可独立复核；
- A/B 表述是否中性、对称；
- participant material 是否泄露答案；
- taxonomy 是否自然；
- 来源、版本和推导是否可追踪；
- 仓库现有内容检查是否通过。

状态只使用：`approved`、`revise`、`reject`。局部问题优先修订当前 case；只有构思本身不成立时才生成第二个候选。

## 5. 推荐给 Codex 的单例任务格式

```
阅读 docs/case-authoring.md、contracts/schemas/case.schema.json、
contracts/examples/case.example.yaml 和 research/templates/case.yaml。

本轮只处理一个候选：
Primary A = <A1-A8>
Primary B = B2 Risk & Uncertainty Evaluation

先完成 Case Concept、taxonomy justification、Ground Truth 设计和来源需求。
不要创建 participant-facing YAML。
如果无法在不依赖个人风险偏好的情况下形成稳定、可复核的 reference answer，
明确判定该构思失败，不要强行继续。
```

第一个 Pilot case 从 **A1 Budgeting × B2 Risk & Uncertainty Evaluation** 开始。

## 6. Workspace Startup

新的 Codex / 工作区开始案例工作时，不依赖聊天历史。先读取：

1. `docs/case-authoring.md`
2. `research/PILOT_STATUS.md`
3. `research/templates/case.yaml`
4. `contracts/schemas/case.schema.json`
5. `contracts/examples/case.example.yaml`

以 `research/PILOT_STATUS.md` 确定当前要处理的 A × B 组合和阶段。完成一个阶段后，只更新必要的研究材料和状态文件；不保存聊天记录或额外过程日志。

如果状态文件与本规范冲突，以本规范为准；如果仓库执行规范与当前 FinDRIFT 研究设计冲突，应先停止生成并同步研究设计，不自行改写研究原则。

