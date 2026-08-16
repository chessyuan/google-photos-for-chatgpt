# Google Photos for ChatGPT v1.1.0

[English](RELEASE_NOTES_v1.1.0.md)

## 一键 Google 相册授权

v1.1.0 面向普通用户简化了连接流程：

- 普通 Release 用户不需要手工配置 OAuth。
- 用户主动点击后，通过 Google 官方账号选择器选择并授权目标 Google 账号。
- 首次授权成功后自动继续打开 Google Photos Picker，不需要第二次点击。
- 后续使用会静默复用当前浏览器会话内仍有效的短期 token。
- 被 API 拒绝的缓存 token 会自动失效，只在需要时要求用户重新连接。
- Popup 提供“已连接”“选择其他账号”和“断开连接”，不显示 Client ID 或 token。
- 根据 Chrome 界面语言显示英文或简体中文。
- 保留 standby session、原子消费、过期处理、MV3 alarm、缓存命中和 OAuth/API fallback。
- 不会保留隐藏的 Google 相册页面，也不会反复强制重开后台标签页。

## 隐私与安全

- 没有维护者自建后端、分析、遥测、Client Secret、refresh token 或私钥。
- 账号选择器模式的短期 access token 只存在于 `chrome.storage.session`，断开连接或浏览器会话结束时清除。
- 所选照片 bytes 只在浏览器内存中存在，随后交给当前 ChatGPT 附件界面。
- 发布前已扫描 credentials、私钥、token、个人邮箱和本机个人路径。

完整说明见 [OAuth、隐私与技术原理](OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md)。

> 发布门槛：代码现在可以公开审查和测试，但在维护者确认 Google OAuth 应用已经是 External、In production，并且 Google Photos Picker scope 已通过适用审核且不再受 Test User 限制前，不应把 v1.1.0 描述为“所有 Google 账号均可无障碍授权”。试用者目前可能看到 Google 的未验证应用警告，或只能使用已配置的 Test User。
