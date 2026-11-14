# 研究者资料

研究者资料与参与者材料分开保存：

- candidates/<slug>/：候选文献、原始任务、来源文件、计算核对、英文草稿和审核状态；
- templates/：Ground Truth 与研究记录模板；
- 通过审核后，才把最小化的参与者材料写入 cases/ 并登记到 cases/catalog.yaml。

研究者侧资料不进入前端材料包，也不写入参与者可见的题干、选项、答案或目标条件。当前正式案例为空；Soll S2 等候选仍处于研究审核阶段。

旧 20 个案例的完整研究资料由 Git 标签 legacy-20-cases 保存。当前分支不再依赖 case_index.json、旧编号目录或旧 PDF/LaTeX 资料。
