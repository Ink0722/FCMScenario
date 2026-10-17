# 内容维护指南

## 首次准备

在项目根目录执行，Python 3.9+：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-tools.lock.txt
```

`requirements-tools.txt` 给出允许范围，lock 文件记录本轮验证的确切版本。npm 的材料命令通过跨平台启动器使用项目 .venv，不向系统 Python 安装依赖。

## 快速定位

| 要修改什么 | 编辑源 |
| --- | --- |
| 某个 case 的题干、背景、条件、比较信息、术语 | `cases/对应目录/case.zh-CN.yaml`，或经译审的 `case.en.yaml` |
| 当前案例清单与语言 | `cases/catalog.yaml` |
| 某项实验开放哪些任务、引用哪个 case | `studies/local-development.yaml` 或其他实验 YAML |
| 本地测试码对应哪些任务 | `studies/fixtures/local-codes.yaml`，仅开发用 |
| 公共英文说明、判断与置信度提示 | `shared/copy/en.yaml` |
| 原中文公共说明 | `shared/instructions.md`；修改后需复核英文译稿的 source_revision |
| Profile 题项 | `shared/questionnaires/profile.zh-CN.yaml`；本轮仍是原开发题项 |
| 页面按钮、状态、颜色和布局 | `frontend/src/app/copy.ts`、`styles.css` 及页面组件 |
| PDF 内容 | 对应案例 `latex/`，使用原 PDF 编译工具 |
| 答案、评分、原始来源、译审依据 | `research/`；原 notes.md 暂保留原路径 |

## 修改一个已有案例

原 20 例同时保留 Markdown 与 YAML，不能独立维护成两套不同内容。

推荐工作方式：编辑 YAML 后显式同步 Markdown，再检查：

```bash
.venv/bin/python tools/cases.py sync --case 01 --from yaml
.venv/bin/python tools/cases.py check --case 01
.venv/bin/python tools/check_content.py
```

如果你更习惯编辑原 `material.md`，改完后反向同步即可：

```bash
.venv/bin/python tools/cases.py sync --case 01 --from markdown
```

`--from yaml` 表示保留 YAML 的修改；`--from markdown` 表示保留 Markdown 的修改。若两边都改过，工具会停止，先手工合并；明确要舍弃另一边修改时才加 `--force`。构建不会代你解决冲突。

YAML 中 `legacy_source` 是同步工具维护的上次对齐记录，正常编辑不要手写哈希。同步不自动编译 PDF，不改 Notes 或研究者评分；改变金融事实时，需要按原流程同步核对相关 PDF 和研究依据。

旧 Markdown 比较表不能容纳单元格内竖线和换行。YAML 虽能表达更复杂文本，verify 模式同步遇到此类内容会明确拒绝，不删字或猜测转义。新语言或新案例可使用没有旧格式配对的 none 模式。

## 添加新案例或英文版本

1. 在 `cases/` 中建立目录，按 `contracts/examples/case.example.yaml` 填写正式内容。参考文件路径相对案例目录，不写绝对路径或网站 URL。
2. 在 `cases/catalog.yaml` 增加稳定 case_id、scenario_id、目录和语言入口。原案例的英文版与中文版使用同一 case_id 和稳定选项／比较项 ID；不要把中文内容标记为 en。
3. 原 20 例继续保留 verify 配对。新 case 或新增英文语言可以用 `legacy_mode: none`，不要求人为生成一份旧中文 Markdown。
4. 在 `studies/对应实验.yaml` 的 tasks 中引用 case_id，使用独立稳定任务编号。需要本地编码验证时，在对应 fixtures 文件中加入任务 ID。
5. 运行内容检查与材料编译。当前本地方案 case_locale 是 zh-CN；要运行英文 case，需创建或调整明确的英文实验配置，所有引用任务都必须有英文版本。

程序不会静默回退语言。未纳入当前实验的已登记案例不会自动开放给参与者；前端打包只包含该实验 tasks 引用的案例。

## 输入格式说明

`case.schema.json` 定义所有允许字段，未知字段会报错。案例不包含 Profile、答案、Goal、参与者编码或作答。

- `options` 需要各一个 A 和 B；`comparison.values` 按选项身份存储，与显示位置无关。
- 金额、费率、日期、限制与例外作为完整原文字符串保存，避免自动解析导致单位或精度变化。
- 背景及补充正文可用 YAML 的 `|` 多行格式，正文支持 Markdown。信息为空时显式写 `[]`，不要编造“无”。
- `references` 以 document_id、标题和本地 PDF 路径维护。访问 URL、文件哈希与材料 revision 由工具生成。
- 同一列表中的稳定 ID 必须唯一。复制输入时保留案例身份，新增案例时分配新身份。
- 重复 YAML 键、缺字段、错误类型、缺文件、路径越界、选项不完整都会阻止打包。

## 重新生成与验证

```bash
# 所有案例语言、共享内容、配置和契约
.venv/bin/python tools/check_content.py
# 所有旧格式配对及结构化输入
.venv/bin/python tools/cases.py check
# 原 PDF/LaTeX、链接与来源哈希，兼容原命令
python3 tools/check_project.py
# 导出一个案例的运行输入，不改源文件
.venv/bin/python tools/cases.py export --case 01 --locale zh-CN
# 生成当前本地前端材料与开发配置
.venv/bin/python tools/prepare_frontend.py
```

其他实验可以通过 `--study studies/文件.yaml` 选择。npm 默认读取 local-development；需要切换 npm 构建使用的实验时，设置 `FCM_STUDY_FILE`。用于本地 Mock 的方案应显式指定自己的 `development_codes` 开发夹具。正式后端不使用这个公开夹具认证。

```bash
cd frontend
npm run materials
npm run build
npm test
npm run test:e2e
```

修改之后新任务使用新快照，已开始任务继续使用旧内容。页面无需重做；正式部署仍需重新构建并发布相应资源。

## PDF 仍按原方式维护

原 LaTeX 和 PDF 均保留原位置，不自动搬动或重写。

```bash
python3 tools/build_pdfs.py --document 14-02
python3 tools/build_pdfs.py 14
python3 tools/build_pdfs.py --check
```

需要原有 XeLaTeX 与字体环境。编译成功不代表金融内容和译文已经核对；编译后仍需文本与目视核验，研究 QA 记录按原规则维护。草稿生成工具仍只写入 build/drafts，不覆盖正式源文件。
