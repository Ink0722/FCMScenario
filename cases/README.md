# 案例编辑入口

cases/ 只保存已经通过研究审核、可以进入参与者界面的正式案例。当前正式案例目录为空：正在编写的候选案例保存在 research/candidates/，通过 Ground Truth 和人工审核后，才建立正式目录并登记到 cases/catalog.yaml。

## 新案例进入正式目录的顺序

1. 在 research/candidates/<slug>/ 保存来源、原始任务、计算核对和英文草稿。
2. 完成人工 Ground Truth 审核，不把研究者答案、目标条件或来源说明写进参与者 YAML。
3. 在 cases/<case_id>_<short-name>/ 创建 case.en.yaml，只放参与者可见材料。
4. 在 cases/catalog.yaml 登记 case_id、scenario_id、英文入口和 legacy_mode: none。
5. 在 studies/<study>.yaml 增加 Task，再在本地 studies/fixtures/local-codes.yaml 配置开发编码。
6. 运行 tools/check_content.py、tools/prepare_frontend.py、前端测试和构建。

字段规范见 contracts/schemas/case.schema.json，完整作者流程见 docs/case-authoring.md。新案例默认使用英文，不创建未经审核的中文副本。

## 文件职责

| 文件或目录 | 作用 |
| --- | --- |
| catalog.yaml | 正式案例的稳定 ID、目录、语言和版本入口 |
| 各案例/case.en.yaml | 经审核的英文参与者材料 |
| 各案例/*.pdf | 参与者需要查看的正式材料；文件路径由 YAML 引用 |
| 各案例/notes.md | 仅在确有维护需要时保存的案例说明，不导出给参与者 |
| research/candidates/ | 研究者侧候选、来源、Ground Truth 和审核记录 |
| studies/ | 将正式案例组合成实验任务和测试码 |
| frontend/public/materials/ | 编译产物，不是编辑源 |

旧 20 个案例及其研究资料已从活动工作树移除，完整旧版由 Git 标签 legacy-20-cases 保存。需要审计时查看标签或从标签创建临时工作树，不要把旧材料重新放回当前参与者目录。
