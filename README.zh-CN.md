# Google Photos for ChatGPT

Google Photos for ChatGPT 是一个本地优先的 Chrome / Chromium 扩展，让用户通过 Google Photos 官方选择器从 Google 相册选取云端照片，并直接添加到 ChatGPT 对话附件区。

```text
ChatGPT → Google Photos 官方选择器 → 选择照片 → 完成
        → 照片出现在 ChatGPT 附件区域
```

无需打开 Windows 文件选择器，不会主动写入 Downloads，也不需要自建服务器。

> 本项目是独立开源项目，与 Google 或 OpenAI 不存在隶属、背书、赞助或官方合作关系。

[English](README.md) · [OAuth、隐私与技术原理](docs/OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md) · [隐私政策](PRIVACY.zh-CN.md) · [安全政策](SECURITY.zh-CN.md)

## v1.1.0 发布状态

v1.1.0 代码已经实现一键 Google 授权，但仅凭 GitHub 源码无法验证维护者 Google Cloud OAuth 应用的 Audience、Publishing status 和 Verification status。**在项目所有者完成并提供 [Google OAuth 检查清单](docs/GOOGLE_OAUTH_VERIFICATION.md)中的控制台证据前，不得声称 v1.1.0 已经能让任意 Google 账号公开授权。**

这个门槛尚未确认时，GitHub 上最新正式版本仍为 v1.0.0。

### 试用前的重要提示

Google 目前可能显示**“Google 尚未验证此应用”**、提示应用处于测试状态，或者拒绝尚未加入 Test Users 的账号。这是维护者尚未完成 Google OAuth 正式发布和验证所造成的真实限制，不是 ChatGPT 的提示，扩展也不会隐藏或绕过它。

只有当授权页面显示 **Google Photos for ChatGPT**，且请求的权限恰好是 `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` 时才应继续。完整原因、工作原理和数据流见 [OAuth、隐私与技术原理](docs/OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md)。

## 快速开始

1. 下载最新版。
2. 解压。
3. 在 Google Chrome 中加载扩展。
4. 打开 ChatGPT。
5. 点击 Google Photos 图标。
6. 第一次使用时登录并授权自己的 Google 账号。
7. 选择照片并点击“完成”。

完成一次授权后，后续点击会复用当前浏览器会话内仍有效的 token 和预先创建的 standby Picker session。真正可见的 Google 相册页面只会在用户点击后打开。

## 主要功能

- 正式构建配置 Web OAuth Client 后，使用 `chrome.identity.launchWebAuthFlow` 和 `prompt=select_account` 打开真正的 Google 官方账号选择器。
- 普通 Release 用户不需要 Token、Client ID、Google Cloud、npm 或开发环境。
- Google Photos 官方选择器，支持单选和多选。
- Google Photos 权限只有 `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`。
- 通过 Chrome `_locales` 自动显示英语或简体中文界面。
- Popup 和 Options 明确显示实际账号模式；只有真正会弹出账号选择器时才显示“选择其他 Google 账号”，不会再把静默刷新伪装成切换账号。
- 将 OAuth 原始错误转换为普通用户可理解的信息，不显示 token。
- 图片仅在浏览器内存处理，不主动保存到 Downloads。
- 保留 standby session、原子消费、过期处理和 MV3 alarms，但不再创建隐藏的 Google 相册窗口或标签页。
- 已授权用户优先静默授权，不重复弹出交互式 OAuth。
- 适配 ChatGPT SPA 重绘，并保留 file input、MutationObserver 和拖放上传策略。

## 安装发行包

1. 从 [GitHub Releases](https://github.com/chessyuan/google-photos-for-chatgpt/releases) 下载 ZIP。
2. 解压到一个长期保留的文件夹。
3. 打开 `chrome://extensions`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择根目录中包含 `manifest.json` 的解压文件夹。
7. 重新加载已经打开的 `https://chatgpt.com/` 页面。

固定 Extension ID：`igacbcmbkglkglkindhcpmagafnboolj`。

本版本只以 Google Chrome 为正式测试和支持目标。

## 连接并使用 Google 相册

扩展不会要求用户输入 Google 密码。第一次由用户主动点击时：

```text
点击 Google Photos
→ Chrome / Google 官方 OAuth 授权
→ 自动创建 Picker session
→ 自动打开 Google Photos Picker
→ 选择照片并点击完成
→ 照片进入 ChatGPT 附件区
```

授权成功后不需要再点击一次。以后扩展会先静默请求授权；缓存授权有效时不会重复显示 Google 授权页面。

Popup 和 Options 会显示：

- **已连接**：Chrome 确认所需 scope，并且一次真实的 Google Photos Picker `sessions.create` 请求已经成功。
- **正在检查**：账号已经授权，但还没有验证 Picker API 是否可用。
- **错误**：Picker API 拒绝或无法完成验证，同时显示不含敏感信息的诊断码。
- **连接 Google 相册**：需要用户主动授权。
- **选择其他 Google 账号**：打开 Google 官方账号选择器。只有 Chrome Extension OAuth Client 的开发构建会明确显示“重新连接当前 Chrome 账号”，并显示当前 Chrome 配置文件账号，不会假装完成账号切换。
- **断开 Google 相册**：清理本扩展的 Chrome Identity 状态，并在再次连接前停止后台预热。

断开连接不会通过自建服务器撤销授权，也不会影响其他无关应用。本扩展没有 token backend。

## 工作方式

```text
Google 官方账号选择器（或明确的 Chrome 配置文件降级模式）
→ POST https://photospicker.googleapis.com/v1/sessions
→ 打开 pickerUri/autoclose
→ 按 Google pollingConfig 轮询
→ 分页 GET /v1/mediaItems
→ 在浏览器内存获取所选媒体
→ Blob → File[] → ChatGPT
→ DELETE Picker session
```

账号选择器构建使用 `chrome.identity.launchWebAuthFlow` 和 Google 的 `prompt=select_account`。短期 access token 只保存在 `chrome.storage.session` 浏览器会话内；扩展没有 refresh token 或 Client Secret。没有配置 Web OAuth Client 的开发构建才降级使用 `getAuthToken`，并把 token 明确绑定到界面显示的 Chrome 配置文件账号。

## 隐私

项目没有自建后端、分析或遥测。Google OAuth 由 Chrome 和 Google Identity 管理。OAuth token 不会展示给普通用户、写入仓库文件或发送到项目自建服务器。账号选择器模式下，短期 access token 只通过 `chrome.storage.session` 保存在当前浏览器会话中，并在断开连接或会话结束时清除。只有用户主动选择的照片会在浏览器内存中处理，并随后交给 ChatGPT。

请阅读完整的 [中文隐私政策](PRIVACY.zh-CN.md)、[English Privacy Policy](PRIVACY.md) 或 [OAuth、隐私与技术原理](docs/OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md)。

## 权限说明

| 权限 | 用途 |
|---|---|
| `identity` | 通过 Chrome Identity 获取和刷新 Google OAuth token。 |
| `identity.email` | 在账号选择器 Client 不可用时，显示并明确使用当前 Chrome 配置文件账号。 |
| `storage` | 保存临时 Picker/job 状态、断开连接偏好，以及仅在账号选择器模式下保存于 `chrome.storage.session` 的短期 access token；不保存图片 bytes。 |
| `activeTab` | 让 Popup 操作用户当前选中的 ChatGPT 页面。 |
| `alarms` | 在 MV3 Service Worker 休眠期间处理 standby session 过期和刷新。 |
| `https://chatgpt.com/*` | 注入快捷图标并把所选文件交给当前 ChatGPT 输入框。 |
| `https://photospicker.googleapis.com/*` | 创建、轮询、读取和删除 Picker session。 |
| `https://oauth2.googleapis.com/*` | 用户断开连接时撤销账号选择器模式的 access token。 |
| `https://lh3.googleusercontent.com/*` | 只下载用户在 Picker 中主动选择的媒体。 |

## 开发者文档

开发、Fork 和自托管 OAuth 配置已与普通用户安装流程分离，详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

完整质量检查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:dist
```

## 已知限制

- Google Photos API 应用公开使用前必须完成 Google 要求的 OAuth 审核；源码无法显示 Cloud Console 当前真实状态。
- Testing 状态只允许配置过的 Test Users，这是 Google Cloud 限制，不是扩展登录逻辑问题。
- 本版本只正式测试 Google Chrome；不对其他 Chromium 浏览器作未经验证的兼容性承诺。
- ChatGPT 是持续更新的 SPA，没有稳定的第三方附件 DOM API，未来页面更新可能需要适配。
- 文件格式、大小、多图数量和服务端上传行为由 ChatGPT 控制。
- WEBP、HEIC、HEIF 会按原 MIME 交给 ChatGPT，但目标站可能拒绝当前不支持的格式。
- 视频会被跳过，本项目只处理图片附件。

更多信息见 [troubleshooting.md](troubleshooting.md)。

## 贡献与许可证

提交 Issue 或 PR 前请阅读 [中文贡献指南](CONTRIBUTING.zh-CN.md) 或 [English contributing guide](CONTRIBUTING.md)，不要公开 access token、credentials、私人照片 URL 或个人文件名。安全问题请按 [中文安全政策](SECURITY.zh-CN.md) 报告。

本项目采用 [MIT License](LICENSE)。
