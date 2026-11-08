# FinDRIFT Pilot Status

This file records the current literature-grounded Pilot scope and progress. It is not a chat log and does not replace the research design in Notion or the operational authoring rules in `docs/case-authoring.md`.

## Current Scope

- Case source: empirical behavioral science, behavioral economics, cognitive psychology, consumer-finance, or financial-literacy research with a traceable financial decision or fraud-related task.
- Answer format: objective A/B decision with an independently reproducible reference answer.
- Adaptation policy: Literature-Grounded, Fidelity-Preserving Adaptation; Level 1 wording/presentation and justified Level 2 task adaptations are allowed. Level 3 substantive reconstruction is generally not accepted.
- Participant material: English only.
- Candidate review: the researcher may specify a small candidate set for comparative reassessment.
- Case production: one approved case at a time; no batch generation.
- Existing 20 cases: excluded from this new-case workflow and must remain untouched.
- Taxonomy: assign the existing OECD-derived 8 × 4 labels only after candidate eligibility and Ground Truth review; no cell-based production quota.

## Active Task: Reassess Two Existing Candidates

The current task is to reassess exactly the following two candidates under the revised adaptation policy:

1. **Choi, Laibson, and Madrian (2010)**, “Why Does the Law of One Price Fail? An Experiment on Index Mutual Funds.” Previous preliminary decision: REJECT because the original task used continuous allocation across four funds. Reassessment must consider whether a defensible Level 2 A/B adaptation is possible. Review: [candidate notes](candidates/choi-2010-index-funds/notes.md).
2. **Soll, Keeney, and Larrick (2013)**, “Consumer Misunderstanding of Credit Card Use, Payments, and Debt: Causes and Solutions.” Previous preliminary decision: NEEDS FURTHER EVIDENCE because the complete questionnaire, response format, and service terms were not verified. Reassessment must consider whether the published evidence supports a transparent adapted task. Review: [candidate notes](candidates/soll-2013-debt-reprocessing/notes.md).

- Current status: reassessment.
- Prompt: [Reassess Two Candidates](prompts/reassess-two-candidates.md).
- Reassess only these two candidates. Do not search for additional papers.
- Append a new `Reassessment under Revised Adaptation Policy` section to each candidate's existing notes; preserve all previous review content as an audit trail.
- Do not generate participant-facing YAML, allocate case IDs, assign final taxonomy labels, or begin Ground Truth approval.
- Do not modify the historical 20 cases.
- Do not modify Notion as part of this Codex task.

## Completed

- Initial review of Choi et al. (2010) completed; the earlier REJECT decision is retained as historical audit information, not treated as binding for this reassessment.
- Initial review and public-source follow-up of Soll et al. (2013) completed; the earlier NEEDS FURTHER EVIDENCE decision is retained as historical audit information, not treated as binding for this reassessment.
- Researcher-side templates and participant-facing schema/renderer have been established.
- No new case has been approved or created.

## Next Stage After Reassessment

After the two reports are reviewed by the researcher:

1. Select one candidate for adaptation design.
2. Develop and review its A/B task formulation.
3. Reconstruct and independently verify Ground Truth.
4. Obtain explicit human approval.
5. Only then create the English participant-facing case and run repository validation.

## Status Values

Use only:

- source_selection_pending
- candidate_review
- reassessment
- ground_truth_review
- participant_material
- approved
- revise
- reject

Update this file when the active candidate set, task stage, or candidate decision changes.
