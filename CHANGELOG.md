# Changelog / 更新日志

All notable changes to Google Photos for ChatGPT are documented here. Versions follow semantic versioning.

Google Photos for ChatGPT 的重要变化记录在此，版本号遵循语义化版本。

## [Unreleased]

- Google OAuth production verification and unrestricted public-account availability remain pending.
- Google OAuth 正式验证及面向所有普通账号的公开可用性仍待完成。

## [1.2.0] - 2026-11-23 · Release / 正式版

- Select ready videos alongside photos. The extension follows Google video CDN redirects, preserves the returned file type, and explains permission or network failures.
- Reopen the Picker while a previous window finishes closing. Pending selections are handed to the composer one at a time.
- Recover the Photos button on open chats after extension reload and align it with the visible upload control on wide composers.
- Reuse valid authorization across restarts and silently renew for the same verified account when Google permits it.

- 支持照片和已处理完成的视频混选。下载跟随 Google 视频 CDN 跳转，按实际返回格式命名，并区分权限和网络错误。
- 关闭选图窗口后可立即再打开。上一批和下一批的结果逐批交付给输入框。
- 扩展重载后会尝试恢复已打开聊天页的入口。加宽输入框时，图标跟随可见的上传控件。
- 浏览器重启后可复用仍有效的授权，并在 Google 允许时为同一已确认账号静默续期。

## [1.1.0] - release candidate

- Added Google's official account chooser with explicit account switching.
- Added honest connected/readiness states backed by a real Picker API request.
- Kept short-lived chooser tokens in browser-session storage only.
- Preserved standby Picker sessions without hidden or self-reopening Google Photos tabs.
- Added bilingual UI, privacy documentation, architecture documentation, and verification guidance.
- Strengthened build verification for the production OAuth and manifest configuration.

- 新增 Google 官方账号选择器与明确的账号切换。
- “已连接/就绪”状态必须由真实 Picker API 请求验证。
- 账号选择器的短期 token 只保存在当前浏览器会话。
- 保留 standby Picker session，但不创建隐藏或自动重开的 Google 相册标签页。
- 增加中英文界面、隐私说明、技术原理和 OAuth 验证指南。
- 加强生产 OAuth 与 manifest 构建校验。

## [1.0.0] - 2026-08-15

- Initial open-source release with Google Photos Picker, ChatGPT attachment handoff, session lifecycle management, and installable `dist/`.
- 首次开源发布，包含 Google Photos Picker、ChatGPT 附件导入、session 生命周期管理和可安装的 `dist/`。

[Unreleased]: https://github.com/chessyuan/google-photos-for-chatgpt/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/chessyuan/google-photos-for-chatgpt/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chessyuan/google-photos-for-chatgpt/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/chessyuan/google-photos-for-chatgpt/releases/tag/v1.0.0
