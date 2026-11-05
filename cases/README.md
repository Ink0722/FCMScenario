# 案例编辑入口

每个案例保存在一个独立目录中，当前 20 例均已新增 `case.zh-CN.yaml`。这是当前中文内容的结构化版本，不是新设计或英文译写。原 `material.md`、`notes.md`、PDF 和 `latex/` 原路径保留。

完整操作见 [内容维护指南](../docs/content-maintenance.md)，字段规范见 [case.schema.json](../contracts/schemas/case.schema.json)。FinDRIFT 新案例采用 one-by-one 编写流程，执行规范见 [FinDRIFT Case Authoring](../docs/case-authoring.md)，研究者侧模板见 [research/templates/case.yaml](../research/templates/case.yaml)。

## 双格式过渡规则

原 20 例在 `catalog.yaml` 中使用 `legacy_mode: verify`。构建同时读取 YAML 和 Markdown，逐项比较背景、共同条件、A/B 信息、补充资料、文件引用、任务、术语和选项。任一不一致即停止，不选择某一份“将就运行”，也不自动覆盖。

在项目根目录激活 Conda `FCMScenario` 后，日常推荐编辑 YAML，再显式同步保留的 Markdown：

```bash
python tools/cases.py sync --case 01 --from yaml
python tools/cases.py check
```

继续编辑原 Markdown 也受支持，改完后显式同步 YAML：

```bash
python tools/cases.py sync --case 01 --from markdown
```

同步工具记录上次对齐版本。两边都被修改时会拒绝覆盖，需先比较并合并；确认舍弃另一边的改动后才使用 `--force`。本轮初始转换没有重写任何原 Markdown、Notes、PDF 或 LaTeX。

## 文件职责

| 文件 | 如何维护 |
| --- | --- |
| `catalog.yaml` | 稳定案例 ID、目录、语言文件、兼容模式；新增案例从这里登记 |
| `各案例/case.zh-CN.yaml` | 中文参与者内容；金融数值、单位、条件与例外按原文维护 |
| `各案例/case.en.yaml` | 译审后的英文内容；当前 Case 01 已提供，其余不创建假英文副本 |
| `各案例/material.md` | 原格式保留，20 例必须与 YAML 对齐 |
| `各案例/*.pdf` | 原正式 PDF 保留原路径；后续新语言可使用 `documents/en/` |
| `各案例/latex/` | 正式 PDF 编辑源，原程序不会被本次重构替换 |
| `各案例/notes.md` | 原研究者说明，暂保留原路径；不导出给参与者 |
| `research/templates/case.yaml` | FinDRIFT 新案例的研究者侧 Ground Truth、taxonomy、来源和审核记录模板 |

## 增加新案例

FinDRIFT 新案例先按 [FinDRIFT Case Authoring](../docs/case-authoring.md) 完成 Case Concept、taxonomy、来源和 Ground Truth 审核；通过后再参考 `contracts/examples/case.example.yaml` 编写 participant-facing YAML，登记 catalog，并在 `studies/对应实验.yaml` 引用它。新案例可使用 `legacy_mode: none`，无需为了旧解析器另写一份中文 Markdown；这不改变原 20 例保留、核对旧格式的规则。

作者填写参考文件的相对路径，不填写最终网站地址、文件哈希、答案、Goal、参与者编码或完成状态。每个 case 的选项 ID 与术语／比较项 ID 在翻译和调整展示顺序时保持稳定。
