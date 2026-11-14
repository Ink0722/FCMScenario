# 实验配置

这里定义实验任务集合与共用资源，不存真实参与者数据。

- local-development.yaml：本地 Mock 使用的实验、语言、Profile 和流程策略。当前没有正式 Task，便于在新案例审核期间检查入口页和空任务状态。
- fixtures/local-codes.yaml：本地开发编码；当前 FCM-EMPTY 对应空任务集合。正式测试码由后端生成，不写入此文件。

新增正式案例时，先在 cases/catalog.yaml 登记案例，再在实验 YAML 的 tasks 中使用稳定的 Task ID 和显示编号；最后把需要本地检查的任务加入开发夹具。Task 只引用案例，不把 Profile、答案、目标条件或研究者备注写入案例内容。

Profile 仍按测试码提交一次；同一测试码可分配多个 Task。开始 Task 后由后端锁定身份和进度。前端不保存正式测试码或研究数据。
