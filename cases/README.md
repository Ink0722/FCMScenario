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

## 增加 FinDRIFT 新案例

新案例采用文献驱动、保真优先、one-by-one 流程。先定位原始实证研究中的具体实验任务，再审核客观 A/B 结构和 Ground Truth；通过后才创建英文 case.en.yaml。研究者侧同时保存 case.yaml、notes.md 和 sources/，分别记录结构化答案依据、原始任务与适配记录、论文及证据文件。

原始论文和补充材料默认只保存在研究者侧，不自动展示给参与者。没有自然比较维度或其他可选内容时，对应字段使用空列表，不得为了填充 UI 而编造信息。新案例登记到 catalog.yaml 时使用英文语言入口和 legacy_mode: none。

历史 20 个案例的中文 YAML、Markdown、PDF、Notes 和 LaTeX 继续保留原状，不属于本轮新案例生产范围。
