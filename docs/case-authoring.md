# FinDRIFT Case Authoring

本文件将 FinDRIFT 主页面中的 Scenario 设计原则转化为仓库内可执行的案例生产规范。研究设计通常以 Notion 的 FinDRIFT 主页面为准；但对于研究者已明确批准、且尚未同步回 Notion 的更新要求，应以最新明确指令为准。本轮两个候选的重新评估采用本文件规定的 Literature-Grounded, Fidelity-Preserving Adaptation；若 Notion 旧文本仍有更严格的历史措辞，应记录待同步事项，不得据此恢复旧的自动拒绝规则。Ground Truth 的客观性要求仍然有效。

## 1. Scope

- 新案例必须有可追溯的实证文献来源，优先选择行为科学、行为经济学、认知心理学、消费者金融与金融素养研究中的个人金融决策或欺诈相关实验。
- 核心 Benchmark 只纳入具有稳定、可复核 reference answer 的客观 A/B 决策。
- 新案例的参与者材料统一使用英文。
- 文献候选筛选可以对研究者指定的小批量候选进行并行比较；正式案例生产仍采用 one-by-one：一次只批准、编写和验证一个案例。
- 本轮新案例生产不处理历史 20 个案例，也不得修改其文件。
- 不预设案例数量，不按 A×B 矩阵格子分配生产任务。

## 2. Literature Source Requirements

优先使用原始实证论文及其 Appendix、Supplementary Materials、实验问卷或作者公开的刺激材料。候选文献应定位到具体实验任务；若完整参与者刺激不可得，应明确区分：

- **full_stimulus**：完整或足以还原任务的参与者材料可得；
- **partially_available**：部分材料可得，关键任务细节仍需核实；
- **described_only**：论文叙述了任务，但未公开完整刺激；
- **not_located**：尚未找到可核验的任务描述或材料。

完整问卷缺失本身不自动构成拒绝理由。应进一步判断论文正文、附录和其他可靠来源是否已提供足够信息，以构造一个透明标注的 literature-grounded adaptation。若缺失信息涉及决策规则、关键条款、选项可行性或 Ground Truth，则必须保留为证据缺口，不得自行补造。

每个候选记录：

- 完整引文、DOI 或稳定 URL；
- 实验编号及论文页码、表格、附录或补充材料位置；
- 参与者群体和原始实验任务类型；
- 原始刺激材料的可获得程度；
- 原始任务的选项、回答方式和实验条件；
- 研究者侧保存的论文、补充材料和相关证据文件；
- 论文直接报告的事实，与研究者推断、拟议改编之间的区别。

原论文为任务结构和行为机制提供实证依据，但其参与者的多数选择、处理组差异或研究结论不构成 FinDRIFT 的 Ground Truth。

## 3. Eligibility Check

候选任务必须满足：

1. 能识别一个明确的个人金融核心决策；
2. 能构造两个清晰、可执行且相互可区分的 A/B 选项；
3. 给定任务事实、约束和明确假设后，存在唯一或稳定的可复核 reference answer；
4. 答案可由明确规则、计算、合同条款、资格要求或独立金融证据推导；
5. 推导所需的关键事实已在参与者材料或预先声明的允许证据环境中提供；
6. 最终判断不依赖未观测的个人偏好、未定义的效用函数或未设定的未来状态；
7. 改编后仍保留原研究中具有实质意义的金融决策问题或行为机制，并准确标注其与原实验的关系。

原始任务优先为 A/B，但这不是硬性准入条件。多选、连续金额分配、概率估计、量表或偏好权衡任务，均可评估是否能通过有限适配形成适合 FinDRIFT 的二元决策。不得仅因原始回答格式不是 A/B 就直接拒绝。

以下情况才构成较强的拒绝理由：

- 无法识别明确的个人金融核心决策；
- A/B 只能通过研究者任意设定阈值、隐藏重要条件或引入未定义偏好才能成立；
- 关键金融事实或规则无法核验，导致答案不稳定；
- 改编后不再保留原研究的核心金融问题或行为机制；
- 需要大幅重构金融产品、服务或主要利益冲突，导致文献不再为该任务提供实质依据。

遇到局部问题时优先给出 revise 或 needs further evidence，不要把“尚未查到”直接等同于“原理上不可行”。明确区分：
- 原始任务格式不适配；
- 候选文献不适合；
- 目前证据不足；
- 可通过有限适配解决的问题。

## 4. Literature-Grounded, Fidelity-Preserving Adaptation

**核心原则：允许有依据的有限改写，保留核心金融决策与行为机制；不要求机械复现原始实验。**

适配分为三个等级。

### Level 1 — Wording and Presentation Adaptation

通常允许：

- 用自然、清晰的英文重写指令；
- 调整句式、段落顺序和信息组织；
- 将长文本映射到 Background、Facts、Options 和 Decision Task；
- 为前端展示进行卡片化、表格化或格式转换；
- 删除经核查确实与决策无关、且删除后不改变信息条件的内容。

即使是 Level 1，也不得通过删减改变参与者可用的信息或选项含义。

### Level 2 — Limited Task Adaptation

可以在有明确研究理由时考虑：

- 将原始多选、连续分配、评分或其他非二元任务转换为 A/B 决策；
- 从原始选项中选择有理论依据的子集；
- 将原任务中的选择维度组织成两个具体、可执行的方案；
- 对金额、利率、期限、概率或其他数值作有限调整；
- 补充构造客观答案所必需的明确假设或条件；
- 将原始回答格式改为 A/B 选择。

Level 2 不是自动许可。每个方案都必须检查：

1. **Core decision**：是否仍是原研究中的同一类金融决策？
2. **Behavioral mechanism**：原研究关注的行为机制是否仍然存在？
3. **Choice set and task demand**：选项集合、认知负担或回答任务是否发生了会影响解释的变化？
4. **Financial validity**：金融计算、合同条件、数值关系和可执行性是否成立？
5. **Ground Truth**：能否在明确条件下独立推导稳定答案？
6. **Interpretation**：论文中应将其描述为原任务复现、任务适配，还是受文献启发的新任务？

对于数值调整，必须记录原始值、改编值、调整理由、所有依赖计算的重算结果，以及调整对决策结果和行为机制可能产生的影响。不得为了方便而随意取整或改变数值。

对于 A/B 转换，必须说明原始任务与新选项之间的映射关系。可以构造原实验中未直接呈现的两个方案，但不得声称这些方案原样出现在原研究中。

### Level 3 — Substantive Reconstruction

通常不接受：

- 将原研究的金融决策替换成无关决策；
- 移除原研究的核心行为机制；
- 凭空创造与原文献无实质关系的金融产品、服务或关键利益冲突；
- 大幅改变主要决策对象、风险结构或核心经济关系，使原研究无法为新任务提供有效依据。

如果 Level 2 适配最终演变为 Level 3，应说明原因并拒绝该方案，而不是仅为了获得一个 A/B 案例而继续改写。

### Adaptation Log

每一项实质性修改均记录：

| Field | Required content |
|---|---|
| Source location | 原论文页码、实验、附录、表格或刺激位置 |
| Original element | 原始任务中的内容或数值 |
| Adapted element | FinDRIFT 拟采用的内容或数值 |
| Adaptation level | Level 1 / Level 2 / Level 3 |
| Rationale | 修改的研究或实验设计理由 |
| Construct impact | 对核心决策、行为机制和任务测量的影响 |
| Financial impact | 对计算、成本、风险和答案的影响 |
| Decision | Keep / Revise / Reject this adaptation |

不得只写“为了适配 A/B”或“为了简化案例”作为充分理由。

### Copyright and Reuse

来源可追溯、作者公开上传或网页可读，不等于获得再发布许可。直接复用原始刺激前，应核实许可或适用使用依据。若采用改写，应保留事实准确性并避免不必要地复制受版权保护的长段表达；记录来源和改写范围。改写不能用来掩盖证据缺口或绕过许可问题。

## 5. Ground Truth Requirements

Ground Truth 标准不因允许适配而降低。

在创建参与者材料之前，研究者侧必须完成：

- `reference_answer`：A 或 B；
- `decision_rule`：可重复执行的判定规则；
- `required_facts`：推导答案必需的事实；
- `derivation`：完整计算或规则应用；
- `source_evidence`：支持事实和规则的独立来源；
- `assumptions`：所有必要且明确的固定条件。

Ground Truth 必须能够由另一位研究者独立复核。原论文中参与者的实际选择、实验组差异或作者解释不能替代这一步。

若答案依赖新增假设，应分别标记：
- 原论文直接支持的事实；
- 其他独立来源支持的事实；
- 为形成可判定任务而新增的 scenario assumption。

新增假设必须在参与者材料中清楚呈现，且不能人为制造一个原本不存在的支配关系。若两个选项的优劣取决于未定义的个人偏好或未知未来状态，不得强行指定唯一正确答案。

Ground Truth 未通过人工审核前，不创建正式 participant-facing YAML。

## 6. Candidate Review and Case Production Workflow

候选文献审查与正式案例生产是两个不同阶段。

### Candidate review

研究者可以指定一组候选供 Codex 并行重新评估。每个候选分别输出：

1. 原始实验和来源证据；
2. 原任务及行为机制；
3. 可能的 A/B 适配方案；
4. 每项适配的等级与影响；
5. Ground Truth 可行性；
6. 证据缺口；
7. 推荐结论：PROCEED TO ADAPTATION DESIGN / NEEDS FURTHER EVIDENCE / REJECT。

不要因为原始任务不是二元格式就自动 Reject。局部证据不足优先使用 NEEDS FURTHER EVIDENCE；原任务形式不适配不等于候选本身不适配。

### One-by-one case production

候选经过研究者选择后，正式案例仍一次只制作一个：

1. **Adaptation design**：明确原始任务到 FinDRIFT A/B 选项的映射；
2. **Ground Truth reconstruction**：完成答案、规则、事实、计算、证据与假设；
3. **Human review**：研究者审核适配和 Ground Truth；
4. **Taxonomy**：通过审核后，再依据 FinDRIFT 主页面的 OECD-derived 8 × 4 taxonomy 标注；
5. **Participant material**：生成英文 `case.en.yaml`；
6. **Validation**：运行 Schema、内容、Loader 和前端检查；
7. **Final review**：通过后才进入下一个案例。

候选 shortlist 可以并行评估；案例 authoring 不批量并行生成。

## 7. Case Artifacts and Information Separation

推荐文件布局：

- `cases/<case_id>_<slug>/case.en.yaml`：参与者可见的英文材料；
- `research/<case_id>/case.yaml`：结构化研究者记录，包含来源、taxonomy、Ground Truth 和审核状态；
- `research/<case_id>/notes.md`：原始实验任务梳理、保真判断和逐项适配记录；
- `research/<case_id>/sources/`：原始论文、补充材料和 Ground Truth 证据。

后续案例按仓库实际分配的稳定 case_id 建立目录，不要复用历史案例 ID。

## 8. Participant-facing YAML Conventions

- `locale` 必须为 `en`。
- 必须有两个且仅有两个选项，ID 分别为 A 和 B。
- Background、Facts、Options 和 Decision Task 按适配后任务的实际内容组织。
- 不存在的 `common_facts`、`comparison`、`additional_information`、`references` 或 `knowledge` 使用空列表，不得编造内容。
- 没有自然比较维度时，不强制创建比较表；使用 cards 展示 A/B 选项。
- 原始论文、补充材料和研究者证据默认只保存在研究者侧，不自动放入参与者可见的 references。
- references 仅用于参与者确实需要打开的文件，不承担研究者文献追溯功能。
- 不得包含 reference answer、隐藏 Goal、taxonomy、研究者推导或参与者数据。
- 不得把新构造的 A/B 方案描述成原论文中原样呈现的方案。

## 9. Review and Validation

逐项检查：

- 文献来源与具体实验可追溯；
- 原始任务材料的可获得程度明确，缺失内容没有被编造；
- A/B 结构清楚、选项真实且可执行；
- 原研究核心金融决策或行为机制得到保留，且改编边界已说明；
- Ground Truth 独立、稳定、可复核；
- 所有必要事实和假设均已呈现；
- 数值、合同条件、计算与金融逻辑正确；
- 适配记录完整，Level 1 / 2 / 3 判断有依据；
- 参与者材料为英文，且不泄露答案、Goal 或研究者信息；
- 使用许可或改写依据已记录；
- Schema、Loader、前端和内容检查通过。

审核状态使用 approved、revise、reject。局部问题优先修订当前候选；只有候选本身不成立或合理适配仍无法满足核心准入条件时才 Reject。

## 10. Codex Operating Rules

- 启动时读取本文件、`research/PILOT_STATUS.md`、研究者模板、Schema 和案例示例。
- 研究设计以 Notion FinDRIFT 主页面为准；若本文件和 Notion 仍有旧版措辞冲突，应明确指出冲突，不要默默回退到更严格的旧规则。
- 对研究者明确指定的候选集，按指定范围完成候选评估；不得擅自扩大文献范围。
- 每次候选评估都要给出可执行的适配方案，而不只是说明原任务为什么不符合 A/B。
- 不得把“原始刺激不完整”自动等同于“不可改编”；判断已发表信息是否足以支持透明、可验证的新任务。
- 不得把“允许改编”理解为可以补造事实、合同条款、选项或 Ground Truth。
- 未经研究者批准，不生成正式参与者材料、不分配正式 case_id、不修改历史 20 个案例。
- 候选审查可以并行比较；正式案例制作必须 one-by-one。
- 不依赖聊天记录；以仓库状态文件和研究者文档为准。
