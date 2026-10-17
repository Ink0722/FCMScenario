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

案例输入与运行 DTO 是两层：作者维护 YAML；编译器校验后将 `values.A/B` 转为现有比较字段，并把本地 PDF 路径转为版本化资源 URL。`source_file`、`legacy_source`、Notes 和答案不进入运行 DTO。Schema 默认拒绝未声明字段。
