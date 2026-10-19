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

`gateway.ts` 描述应用需要的服务能力，尚不是 OpenAPI 或网络实现；后续确定 HTTP 协议时可以另加 OpenAPI 文档。前端原类型路径保留为兼容导出，因此大部分组件不需要重写。

`DialoguePolicy` 中的 `canEnd`、`probeRequired` 决定是否允许结束对话。可选字段 `minTurnsBeforeEnd`、`completedTurns` 用于显示最低交流轮数和剩余轮数，一轮指用户发送一条消息并得到 AI 回复，开场白不计入。后端接入时，应在任务初始化、消息回复、判断提交和会话恢复时一起返回这两个字段；计数以服务端确认完成的交流为准，重复请求不得重复计数。旧接口未提供数值时，前端使用通用提示，不猜测最低轮数，也不改变 `canEnd` 的权限判断。

案例输入与运行 DTO 是两层：作者维护 YAML；编译器校验后将 `values.A/B` 转为现有比较字段，并把本地 PDF 路径转为版本化资源 URL。`source_file`、`legacy_source`、Notes 和答案不进入运行 DTO。Schema 默认拒绝未声明字段。

`SharedCopy.confidence_notes` 为可选 Markdown 文案，保存置信度输入框后的测量边界和中性填写说明；存在该字段时，`confidence_scale` 在输入框前显示定义、填写规则和 0 / 50 / 100 的文字锚点。两部分随 SharedCopy 版本一同冻结，所有判断阶段共用；旧会话缺少该字段时保留原说明位置与端点提示，不拼接当前版本文案。
