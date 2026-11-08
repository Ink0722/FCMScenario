# FinDRIFT Case Authoring

本文件将 FinDRIFT 主页面中的 Scenario 设计原则转化为仓库内可执行的案例生产规范。研究设计以 Notion 的 FinDRIFT 主页面为准；本文件负责指导文献筛选、原始实验任务提取、必要适配、Ground Truth 审核和英文材料生成。

## 1. Scope

- 新案例必须有可追溯的实证文献来源，优先选择行为科学、行为经济学、认知心理学、消费者金融与金融素养研究中的个人金融决策或欺诈相关实验。
- 核心 Benchmark 只纳入具有稳定、可复核 reference answer 的客观 A/B 决策。
- 新案例的参与者材料统一使用英文。
- 采用 one-by-one 流程：一次只评估一个候选文献任务；只有当前候选不合格时，才进入下一个候选。
- 本轮不处理历史 20 个案例，也不修改其文件。
- 不预设案例数量，不按 A×B 矩阵格子分配生产任务。

## 2. Literature Source Requirements

优先使用原始实证论文及其 Appendix、Supplementary Materials、实验问卷或作者公开的刺激材料。候选文献必须能够定位到具体实验和参与者实际完成的任务，而不能仅仅在理论上讨论相关现象。

每个候选记录：

- 完整引文、DOI 或稳定 URL；
- 实验编号及论文页码、表格、附录或补充材料位置；
- 参与者群体和实验任务类型；
- 原始刺激材料是否完整公开；
- 原始任务的选项、回答方式和实验条件；
- 研究者侧保存的论文、补充材料和相关证据文件。

原论文为任务结构提供实证依据，但其参与者的多数选择、处理组差异或研究结论不构成 FinDRIFT 的 Ground Truth。

## 3. Eligibility Check

候选任务必须同时满足：

1. 能识别一个明确的个人金融核心决策；
2. 原始任务本身优先为 A/B；非二元任务只有在能够自然形成二元决策且不改变研究构念时才可考虑；
3. 给定事实和约束后存在唯一或稳定的可复核 reference answer；
4. 答案可由明确规则、计算、合同条款、资格要求或独立金融证据推导；
5. 推导所需的关键事实已在材料或允许的证据环境中提供；
6. 不依赖未观测的个人偏好、效用函数或未设定的未来状态；
7. 可以在不实质改变原任务的情况下适配 FinDRIFT。

以下情况原则上拒绝进入核心 Benchmark：

- 任务要求连续金额分配、概率估计或多维偏好排序，且没有自然的二元决策；
- A/B 只能通过研究者任意选择阈值或加入未设定偏好才能形成；
- 原始实验任务无法定位，且论文描述不足以可靠复现；
- 适配会改变任务构念、关键条件、决策难度或正确答案。

若候选不合格，记录具体原因并停止当前候选，不要通过大幅改写将其“修成”合格案例。

## 4. Preservation and Adaptation

**Preserve by default; modify only when necessary.**

默认保留原始任务的情境、信息、选项、数字、金额、利率、期限、概率、限制、例外和关键措辞。

不得仅为了缩短文本、方便排版或提高表面可读性而：

- 删除原始刺激中的信息；
- 改变金额、利率、期限、概率或其他数值；
- 删除可能影响决策的条件、限制或例外；
- 重写选项，使其含义或吸引力发生变化。

仅在以下情形考虑修改：

1. 原始任务需要被映射为 FinDRIFT 的 A/B 选择，且该映射不改变原构念；
2. 为使 reference answer 可复核，必须补充一个来源明确、现实合理且不会改变任务性质的必要条件；
3. 为适配前端而进行不改变信息含义的格式调整或忠实翻译。

每项修改都必须记录：原文位置、原始内容、修改后内容、修改原因、为什么不可避免，以及可能影响。若某项改动可能改变决策逻辑或答案，应优先放弃该候选。

直接复用原始刺激材料前，应核实许可或合理使用依据；如不能直接复用，应采用忠实改写，保留关键事实、数字和决策结构，并记录改写。

## 5. One-by-One Workflow

每轮只处理一个候选，按以下顺序执行：

1. **Candidate identification：**找到一篇具体实证文献，并定位其中一个实验任务；此阶段不创建 participant-facing YAML。
2. **Original-task extraction：**记录原始实验编号、参与者任务、刺激材料、选项、回答方式和原始材料可获得程度。
3. **Eligibility review：**判断任务是否自然形成客观 A/B 决策；如果不满足，记录原因并停止当前候选。
4. **Ground Truth first：**先完成 reference answer、decision rule、required facts、derivation、source evidence 和 assumptions，并通过人工审核。
5. **Taxonomy：**Ground Truth 明确后，再确定 Primary A、Primary B 和 secondary metadata；不为填满矩阵而选题或改标签。
6. **Fidelity-preserving adaptation：**仅进行必要的翻译、界面格式映射或最小内容调整，并逐项记录。
7. **Participant material：**审核通过后，才创建英文 case.en.yaml。
8. **Validation：**运行 Schema、内容、Loader 和前端检查，再进行人工复核。

如果候选失败，不要同时生成多个替代案例；先明确失败原因，再开始下一个候选。

## 6. Case Artifacts and Information Separation

推荐文件布局：

- cases/21_<slug>/case.en.yaml：参与者可见的英文材料；
- research/21/case.yaml：结构化研究者记录，包含来源、taxonomy、Ground Truth 和审核状态；
- research/21/notes.md：原始实验任务梳理、保真判断和逐项适配记录；
- research/21/sources/：原始论文、补充材料和 Ground Truth 证据。

后续案例按仓库实际分配的稳定 case_id 建立目录，不要复用历史案例 ID。

## 7. Participant-facing YAML Conventions

- locale 必须为 en。
- 必须有两个且仅有两个选项，ID 分别为 A 和 B。
- Background、Facts、Options 和 Decision Task 按原始任务实际内容组织。
- 不存在的 common_facts、comparison、additional_information、references 或 knowledge 使用空列表，不得编造内容。
- 没有自然比较维度时，不强制创建比较表；使用 cards 展示 A/B 选项。
- 原始论文、补充材料和研究者证据默认只保存在研究者侧，不自动放入参与者可见的 references。
- references 仅用于参与者确实需要打开的文件，不承担研究者文献追溯功能。
- 不得包含 reference answer、隐藏 Goal、taxonomy、研究者推导或参与者数据。

## 8. Review and Validation

逐项检查：

- 文献来源与具体实验可追溯；
- 原始任务材料的可获得程度明确；
- A/B 结构自然，选项真实且可执行；
- Ground Truth 独立、稳定、可复核；
- 没有遗漏会改变答案的重要事实；
- 适配记录完整且没有实质改变构念；
- 英文材料忠实于原任务；
- 没有泄露答案、Goal 或研究者信息；
- 使用许可或改写依据已记录；
- Schema、Loader、前端和内容检查通过。

审核状态使用：approved、revise、reject。局部问题优先修订当前候选；只有候选本身不成立时才开始下一个。

## 9. Codex Task Prompt

每轮只交给 Codex 一个候选文献任务：

- Read docs/case-authoring.md, research/PILOT_STATUS.md, research/templates/case.yaml, and research/templates/notes.md.
- Read contracts/schemas/case.schema.json and contracts/examples/case.example.yaml.
- Identify the original experiment, exact source location, task format, stimulus availability, participant-facing instructions, options, and response format.
- Assess whether it naturally supports an objective A/B decision.
- Do not create participant-facing YAML before the source, eligibility, and Ground Truth have passed review.
- Preserve the original task by default. Do not shorten it, change numerical values, or remove conditions unless a specific change is strictly necessary. Log every adaptation and its rationale.
- If the task cannot support a stable, independently reproducible reference answer without materially changing the original task, reject the candidate and explain why. Do not force it into an Axis A × Axis B cell.

## 10. Workspace Startup

新工作区开始前先读取本文件、research/PILOT_STATUS.md 和两个研究者模板。以 Pilot Status 确定当前候选和阶段；不依赖聊天记录，不批量生成案例。每完成一个候选，只更新对应研究记录和必要的状态文件。
