# Codex Task — Reassess Two FinDRIFT Candidates Under the Revised Adaptation Policy

You are responsible for the literature-grounded scenario development of FinDRIFT. This task is a reassessment of exactly TWO previously reviewed candidates. The previous decisions were made under an overly restrictive interpretation of adaptation and must not be treated as binding.

## 1. Read First

Read:

- `docs/case-authoring.md`
- `research/PILOT_STATUS.md`
- `research/candidates/choi-2010-index-funds/notes.md`
- `research/candidates/soll-2013-debt-reprocessing/notes.md`
- `research/templates/case.yaml`
- `research/templates/notes.md`
- `contracts/schemas/case.schema.json`
- `contracts/examples/case.example.yaml`

Research-design authority:

https://www.notion.so/3f63854bbee980fcb9d4d70502d06995

The researcher has explicitly approved a newer adaptation policy for this reassessment. If the Notion page or historical v3 wording still contains the older, more restrictive adaptation rule, treat that wording as pending synchronization and apply the latest approved policy in this prompt and `docs/case-authoring.md`. Do not silently restore the old automatic-rejection rule. The objective Ground Truth requirement remains unchanged.

Apply **Literature-Grounded, Fidelity-Preserving Adaptation**. Do not reject a candidate merely because its original task was non-binary or because the full original questionnaire is unavailable; assess whether a transparent, evidence-based adaptation is feasible.

## 2. Revised Adaptation Policy

FinDRIFT does not aim to reproduce every original behavioral experiment exactly. It aims to construct experimentally usable, objective A/B financial decision scenarios grounded in prior empirical research.

Use three adaptation levels:

- **Level 1 — Wording and presentation:** rewrite wording, reorganize information, translate, adapt the UI, or remove information verified to be decision-irrelevant.
- **Level 2 — Limited task adaptation:** convert a non-binary task into A/B; select a theoretically meaningful subset of options; construct two explicit options; make justified numerical adjustments; add explicit assumptions needed for an objectively answerable task; or change the response format.
- **Level 3 — Substantive reconstruction:** replace the core financial decision, remove the original behavioral mechanism, or substantially invent a different product, service, or economic trade-off. Generally reject this level.

Level 2 is allowed but must be justified. For each proposed change, evaluate its effect on the core decision, behavioral mechanism, choice set, task demand, financial validity, and Ground Truth.

Do not change numbers merely for convenience. If values change, recalculate all dependent quantities and explain the impact.

Ground Truth requirements remain strict. A/B must have a stable, independently reproducible reference answer based on explicit facts, rules, calculations, and assumptions. Original participant majority choices, treatment effects, and author interpretations are not Ground Truth.

A missing complete questionnaire does not automatically disqualify a candidate if the published empirical description provides enough reliable information to construct a transparent adapted task. However, missing facts that determine the options, contract terms, calculations, or answer must remain explicit evidence gaps.

## 3. Candidate A — Choi, Laibson & Madrian (2010)

Paper:

*Why Does the Law of One Price Fail? An Experiment on Index Mutual Funds.*

Original task: the 2007 Harvard staff fees-treatment task involving a hypothetical $10,000 allocation across four S&P 500 index funds.

Previous decision: REJECT, because the original response was a continuous allocation across four funds rather than a binary choice.

Reassess whether a Level 2 adaptation can preserve the core investment-fee decision and the relevant fee-salience / information-search mechanism.

Explore, but do not assume, possibilities such as:

1. Selecting a meaningful pair of funds from the original menu.
2. Constructing two predefined investment options from the original alternatives.
3. Creating a focused binary comparison of otherwise similar index funds with different fee structures.

Evaluate carefully:

- Whether the funds provide sufficiently comparable investment exposure.
- Front-end loads, annual expense ratios, minimum investment amounts, and redemption fees.
- Whether the holding period and redemption timing change the cost comparison.
- Whether the original fee-information and search-cost mechanism remains relevant.
- Whether selecting two funds or constructing predefined options materially changes the choice set or behavioral construct.
- Whether a stable objective answer can be established without pretending future returns are known.

Do not omit conditions such as the UBS short-term redemption fee. If a proposed pair or design is not viable, explain why and assess another reasonable adaptation of this same candidate before recommending rejection.

## 4. Candidate B — Soll, Keeney & Larrick (2013)

Paper:

*Consumer Misunderstanding of Credit Card Use, Payments, and Debt: Causes and Solutions.*

Original task: the 74-undergraduate debt-reprocessing service task described in the Discussion of Study 2.

Previously reported facts:

- Existing credit card debt: $10,000.
- APR: 17.9%.
- Monthly card spending: $300.
- Current monthly payment: $450.
- Reported repayment duration under the current arrangement: 29 years.
- Debt-reprocessing service quote: $700 per month for three years.
- The authors' discussion also reports a self-managed three-year repayment amount of approximately $661 per month.

Previous decision: NEEDS FURTHER EVIDENCE, because the original questionnaire, response format, and complete service terms were not verified.

Reassess whether a transparent literature-grounded adaptation can be constructed.

Consider possible designs such as:

1. Comparing a debt-reprocessing service with a clearly specified self-managed repayment plan.
2. Comparing two repayment plans with the same repayment objective.
3. Creating an A/B task about understanding total repayment cost, debt payoff time, or the financial implications of the service quote.

Investigate:

- Whether the published numbers are sufficient to reconstruct repayment calculations.
- Whether the approximately $661/month figure can be independently verified.
- Whether the $700/month service quote can be compared fairly with a self-managed alternative.
- Which service terms and benefits are known, unknown, or newly assumed.
- Whether reasonable explicit assumptions can create an objectively answerable task without silently eliminating service value or personal preferences.
- Whether the adaptation preserves the original debt-misunderstanding mechanism.

Do not claim that participants originally saw the $661 figure unless the source confirms it. Do not infer that the original response was Yes/No from the 72% response summary.

A complete original questionnaire is desirable but not an absolute requirement. If the paper gives enough reliable information for a new, transparently labelled adaptation, assess that possibility. If not, specify exactly which missing facts prevent it.

## 5. Required Report for Each Candidate

Append a new section titled:

`## Reassessment under Revised Adaptation Policy`

to each candidate's existing `notes.md`. Preserve all previous review content as an audit trail. Do not rewrite or erase the earlier decision.

For each candidate, include:

### A. Original Study Summary

- Full citation and DOI.
- Exact experiment location.
- Original participant task and response format, distinguishing confirmed facts from unknowns.
- Original behavioral mechanism.
- Available materials and remaining evidence gaps.

### B. Adaptation Feasibility

Use a table:

| Element | Original Study | Proposed FinDRIFT Adaptation | Adaptation Level | Justification | Potential Impact |
|---|---|---|---|---|---|

Cover decision structure, A/B options, numerical values, relevant financial facts, contextual information, response format, and assumptions.

### C. Proposed A/B Designs

Propose up to TWO plausible A/B formulations for each candidate.

For each formulation, specify:

1. Central decision question.
2. Option A and Option B.
3. Original elements preserved.
4. Modified elements.
5. Why each modification is justified.
6. Expected reference answer, only if determinable.
7. Decision rule and supporting evidence.
8. Remaining uncertainties.

These are conceptual designs, not final participant-facing case materials.

### D. Behavioral Construct Assessment

Explicitly distinguish:

- Preserved behavioral mechanism.
- Modified measurement task.
- Potential construct changes.
- Whether the adaptation remains a meaningful literature-grounded extension.

Do not merely call the adaptation "similar" to the original.

### E. Ground Truth Feasibility

- Assess whether an independent reference answer can be established.
- Show formulas and calculations where relevant.
- State assumptions explicitly.
- Separate paper-reported facts, independently sourced facts, and newly introduced scenario assumptions.
- Do not freeze or claim approval of Ground Truth.

### F. Recommendation

Choose one:

- **PROCEED TO ADAPTATION DESIGN** — a promising adaptation can be developed further.
- **NEEDS FURTHER EVIDENCE** — a promising adaptation exists, but specific source or financial facts remain unresolved.
- **REJECT** — no reasonable adaptation preserves the core financial decision and behavioral mechanism while meeting objective-answer requirements.

Distinguish rejecting the original response format from rejecting the candidate's potential as an adapted scenario.

## 6. Compare Both Candidates

Provide a comparison table:

| Dimension | Choi et al. (2010) | Soll et al. (2013) |
|---|---|---|
| Original task suitability | | |
| Adaptation feasibility | | |
| Behavioral mechanism preservation | | |
| Objective A/B feasibility | | |
| Ground Truth feasibility | | |
| Evidence availability | | |
| Overall recommendation | | |

Recommend which candidate should be prioritized for the first Gold Case and explain why. Do not choose only because it is easier to write.

## 7. Scope and Repository Rules

- Reassess exactly these two candidates; do not search for additional papers.
- Do not modify the historical 20 cases.
- Do not generate participant-facing YAML.
- Do not allocate formal case IDs.
- Do not assign final OECD taxonomy labels.
- Do not begin full Ground Truth approval.
- Do not modify Notion in this task.
- Do not overwrite the original candidate review; append the reassessment section only.
- Update `research/PILOT_STATUS.md` to show that both candidates are under reassessment and link to their reports.
- Preserve source evidence and distinguish facts from inference.
- Do not contact authors or send external messages.

## 8. Stop Condition

Complete the two reassessments, update the two candidate notes and Pilot Status, and present the comparative recommendation.

**Stop and wait for human review. Do not author a case until explicitly approved.**
