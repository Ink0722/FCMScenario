# 共享实验内容

- `instructions.md`：原中文公共说明及测量文案，原件保留。
- `copy/en.yaml`：独立英文公共说明与测量译稿，已从前端目录移出。`source_revision` 绑定中文原文 SHA-256；原文变化后必须译审再更新该值。
- `questionnaires/profile.zh-CN.yaml`：原有两道开发题项，文字、选项、ID 和取值保持不变，按编码独立提交一次。正式 Profile 仍待用户专题设计。

前端按钮、页面标题和操作提示属于 UI 文案，继续维护 `frontend/src/app/copy.ts`；案例题干、条件与术语属于案例内容，维护 `cases/`。不要把公共问卷复制进每个 case。

通过 `studies/local-development.yaml` 选择当前实验的资源。源文件改变后运行前端材料编译；`frontend/src/generated/` 是生成产物，不能作为第二份手工编辑源。
