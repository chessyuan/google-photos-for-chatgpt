# 贡献指南

[English](CONTRIBUTING.md)

感谢你帮助改进 Google Photos for ChatGPT。

## 提交 Issue 前

- 先搜索已有 Issue。
- 不要提交 OAuth token、credentials、私人照片 URL、私人文件名或账号数据。
- 上传失败时，请说明 Phase 1 与 Phase 2 诊断是否通过。
- 提供 Chrome 版本、扩展版本和经过脱敏的错误信息。

## 开发流程

1. Fork 仓库并创建范围明确的分支。
2. 执行 `npm install` 安装依赖。
3. 如需连接真实 Picker，请按 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 在 `.env.local` 配置你自己的 Chrome Extension OAuth Client；真实账号选择器还需要你自己的 Web OAuth Client。Fork 不应复用维护者的 Google Cloud 项目。
4. OAuth、Picker 与 ChatGPT 附件链路的改动应保持聚焦。
5. 行为变化需要增加或更新测试。
6. 运行完整检查：

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run verify:dist
   ```

7. 在 Pull Request 中说明用户可见变化和测试证据。

## Pull Request 要求

- 不要提交 `.env.local`、credentials、token、私钥、日志或真实照片数据。
- 不要加入旧 Google Photos Library scope。
- 不要依赖 ChatGPT 随机生成的 CSS class。
- 保留取消、session 删除和 MV3 Service Worker 恢复行为。
- 未经清晰的功能与隐私说明，不要增加分析、自建服务器或新权限。
- 英文和简体中文的用户文档、locale 文案需要同步更新。

提交贡献即表示你同意按 MIT License 授权该贡献。
