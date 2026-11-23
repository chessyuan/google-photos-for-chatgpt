# 安全政策

[English](SECURITY.md)

## 支持版本

安全修复只应用于最新正式发布版本。

## 报告安全问题

请优先使用本仓库的 GitHub Private vulnerability reporting。不要在公开 Issue 中发布 access token、refresh token、credentials、私人媒体 URL、个人文件名或账号信息。

报告应包含经过脱敏的影响说明、受影响版本、复现步骤和建议修复方式。不要把真实的 Google 或 GitHub 凭据作为 PoC。

## 项目安全模型

- 扩展没有自建后端。
- Google OAuth 通过 `chrome.identity` 和 Google 官方 OAuth endpoint 完成。
- 只有用户明确选择的媒体才会进入浏览器内存，并交给当前 ChatGPT 页面。
- 临时 Picker 状态保存在 `chrome.storage.session`。账号选择器授权保存在限制为 `TRUSTED_CONTEXTS` 的 `chrome.storage.local` 中，并有会话副本；两份 token 都不向 ChatGPT content script 暴露。Token 保留 Google 的有效期，断开连接时删除。静默续期必须具有已验证的账号标识，并验证新 token 属于同一账号。图片 bytes 不会写入该存储。
- 扩展不包含 Client Secret、refresh token、私钥、分析、遥测或维护者运营的 token 服务。
- 正式构建的扩展页面 CSP 只允许本地脚本。

完整信任边界和数据流见 [OAuth、隐私与技术原理](docs/OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md)。
