# 后端接入目录

本目录预留给后续后端实现，尚无可运行服务，未绑定框架、数据库或真实 Agent。

- `app/`：后续放接口与业务代码，先按访问／参与者、任务、会话、对话与 Agent、数据记录等模块组织。
- `migrations/`：数据库结构变更纳入版本管理。
- `tests/`：后端测试。
- `runtime/`：未来本地数据库、上传和运行产物，已被 Git 忽略。真实参与者数据不存入案例文件。

后端读取根目录 `contracts/schemas/` 的中立数据规范；现有前端能力约定见 `contracts/gateway.ts`。不要导入 React 组件或 `frontend/src/questionnaire/config.ts`。具体 HTTP 路径、认证方案和数据库模型应在实现时确定，本轮未虚构可调用接口。

案例来源为 `cases/catalog.yaml` 和对应案例 YAML；Python 工具可以使用 `tools/case_content.py` 的读取与校验逻辑，其他语言按同一 Schema 实现。版本化参与者 JSON 及受控 PDF 可以作为服务端发布输入，研究者资料独立读取，不能将整个 `cases/` 或 `research/` 作为静态站点目录发布。

## 需要服务端落实的职责

1. 稳定 participant 身份、真实测试码、凭证、有效期和授权。
2. 编码与任务绑定；每个代码一次的 Profile；任务状态和开始锁定。
3. 会话与材料版本冻结、请求幂等、对话恢复、完成确认。
4. 隐藏实验条件、随机化、真实 Agent、轮数规则与状态策略。
5. 明确执行 `abandonTask` 的清除范围，保留已完成结果和已提交 Profile。
6. 参与者结果持久化、文件权限、运行日志及异常恢复。

`studies/local-development.yaml` 是本地验证方案；`studies/fixtures/local-codes.yaml` 中的编码是公开的开发夹具，不能作为正式认证机制。实际编码、绑定、作答和完成状态由后端存储。
