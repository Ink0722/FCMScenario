# 前后端与内容契约

`schemas/` 是语言中立的数据规范；采用 JSON Schema Draft 2020-12。本目录不依赖 React，不包含隐藏目标、研究者答案或参与者数据。

| 文件 | 用途 |
| --- | --- |
| `case.schema.json` | 每种语言的一份案例输入，版本 2.0 |
| `catalog.schema.json` | 案例目录、身份、语言和兼容模式 |
| `shared-copy.schema.json` | 公共译稿及原文版本 |
| `questionnaire.schema.json` | 独立问卷配置 |
| `study.schema.json` | 案例与实验任务映射、流程规则 |
| `development-codes.schema.json` | 仅供开发的任务绑定夹具 |
| `runtime.schema.json` | 前后端使用的参与者 DTO 与提交数据 |

`generated/types.ts` 由 runtime Schema 自动生成，提交到版本管理；修改 Schema 后执行：

```bash
python3 tools/generate_contracts.py
python3 tools/generate_contracts.py --check
```

构建会检查生成类型是否过期。生成器只处理本契约使用的本地 `$defs`、对象、数组、联合与基础类型；遇到不支持的类型会明确失败，不猜测。类型检查不能替代运行时 JSON Schema 校验。

`gateway.ts` 描述应用服务能力，`TurnGateway` 补充消息受理、运行查询和观察；HTTP 实现与服务端路径见 [HTTP 协议](../docs/http-protocol.md)。API 运行时提供 /docs 和 /openapi.json，公开 DTO 的详细约束仍以本目录 Schema 为准。前端原类型路径保留为兼容导出。

`AccessGrant` 使用 participantId/codeDisplay 表示稳定参与记录和脱敏标识。可选 testCode 仅保留旧 Mock 的兼容字段，HTTP 服务不返回原始码。`TurnSnapshot` 包含公开消息、状态、policy、stage 和 revision；`SessionProgress.activeTurn` 用于刷新后观察原运行。Message.status/citations 表示部分生成和来源；这些可选字段使旧 Mock 仍可运行。

`DialoguePolicy` 中的 `canEnd`、`probeRequired` 决定是否允许结束对话。可选字段 `minTurnsBeforeEnd`、`completedTurns` 用于显示最低交流轮数和剩余轮数，一轮指用户发送一条消息并得到 AI 回复，开场白不计入。后端接入时，应在任务初始化、消息回复、判断提交和会话恢复时一起返回这两个字段；计数以服务端确认完成的交流为准，重复请求不得重复计数。旧接口未提供数值时，前端使用通用提示，不猜测最低轮数，也不改变 `canEnd` 的权限判断。

案例输入与运行 DTO 是两层：作者维护 YAML；编译器校验后将 `values.A/B` 转为现有比较字段，并把本地 PDF 路径转为版本化资源 URL。`source_file`、`legacy_source`、Notes 和答案不进入运行 DTO。Schema 默认拒绝未声明字段。

`SharedCopy.confidence_notes` 为可选 Markdown 文案，保存置信度输入框后的测量边界和中性填写说明；存在该字段时，`confidence_scale` 在输入框前显示定义、填写规则和 0 / 50 / 100 的文字锚点。两部分随 SharedCopy 版本一同冻结，所有判断阶段共用；旧会话缺少该字段时保留原说明位置与端点提示，不拼接当前版本文案。
