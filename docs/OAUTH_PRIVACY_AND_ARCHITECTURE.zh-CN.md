# OAuth、隐私与技术原理

[English](OAUTH_PRIVACY_AND_ARCHITECTURE.md)

本文详细说明 Google Photos for ChatGPT 的工作原理、当前 Google OAuth 风险提示的原因、哪些数据留在本地，以及哪些数据会按功能需要发送给 Google 或 ChatGPT。

## 当前 OAuth 验证状态

扩展功能已经可以运行，但维护者的 Google OAuth 应用**尚未完成面向所有普通用户所需的正式验证与发布流程**。

根据 Google Cloud 项目当前状态，登录时可能出现：

- “Google 尚未验证此应用”或类似风险提示；
- 应用仍处于测试状态的提示；
- 非 Test User 账号无法访问；
- 应用请求 Google Photos Picker 权限的提示。

这些提示由 Google 生成，原因是 OAuth consent 配置尚未完全验证或发布；它不是 ChatGPT 生成的，扩展也不会隐藏或绕过这类提示。

试用者只有在以下条件全部满足时才应继续：

1. 扩展来自本仓库或本仓库的正式 Release。
2. Google consent screen 显示的应用名是 **Google Photos for ChatGPT**。
3. Google Photos 权限只有：

   ```text
   https://www.googleapis.com/auth/photospicker.mediaitems.readonly
   ```

4. 试用者认识该 Google Cloud 项目，或已被明确添加为 Test User。

尚未完成的验证工作记录在 [GOOGLE_OAUTH_VERIFICATION.md](GOOGLE_OAUTH_VERIFICATION.md)。在完成前，本项目不会声称所有 Google 账号都能无提示授权。

## 为什么存在两个公开 OAuth Client ID

OAuth Client ID 用于标识应用，属于公开客户端配置，不是密码或 Client Secret。

- **Web application Client** 配合 `chrome.identity.launchWebAuthFlow` 和 Google 的 `prompt=select_account`，让用户真正选择包含目标相册的 Google 账号。
- **Chrome Extension Client** 保留为开发与兼容恢复时的 Chrome 配置文件降级路径。

固定扩展回调地址为：

```text
https://igacbcmbkglkglkindhcpmagafnboolj.chromiumapp.org/
```

扩展中不包含 Client Secret 或 refresh token。

## 完整数据流程

```text
用户点击 Google Photos 按钮
→ Google 官方账号选择与 OAuth consent
→ 短期 access token 进入 chrome.storage.session
→ POST photospicker.googleapis.com/v1/sessions
→ 打开 Google Photos 官方 Picker
→ 用户主动选择媒体并点击“完成”
→ 扩展按 Google 返回的 polling 配置轮询 session
→ 仅列出用户选中的媒体项目
→ 所选 bytes 从 Google 媒体 host 直接进入浏览器内存
→ Blob/File 对象交给当前 chatgpt.com 附件界面
→ 删除 Picker session，释放临时内存数据
```

整个流程没有项目维护者运营的后端服务器。

## 哪些信息保留在本地

- Picker 任务状态、过期时间、轮询配置、窗口和标签 ID 只作为临时浏览器会话数据使用。
- 账号选择器模式的 access token 只保存在 `chrome.storage.session`，断开连接或浏览器会话结束后清除。
- 所选照片 bytes 只以浏览器内存中的 `Blob` 和 `File` 对象短暂存在。
- 扩展不会主动把照片写入 Windows Downloads。
- 项目没有分析、遥测、广告 SDK 或远程可执行代码。

## 哪些信息会离开设备

扩展必须与用户主动选择使用的服务通信才能完成核心功能：

- Google 接收 OAuth、Picker session 和所选媒体请求。
- Google 提供的媒体 host 返回用户选中的照片 bytes。
- 扩展把文件交给当前 ChatGPT 附件界面后，ChatGPT 会接收这些文件。

项目维护者不会收到 token、照片、文件名或 ChatGPT 对话数据，因为项目没有自建服务器。Google 和 OpenAI 仍会依据各自条款与隐私政策处理其服务中的数据。任何软件都不能诚实承诺绝对零风险；本项目能够明确保证的是：架构中没有额外增加由维护者控制的数据收集或传输通道。

## OAuth 与 Picker 生命周期

1. 真正的账号选择只会在用户主动点击后开始。
2. 扩展校验 OAuth `state` 和固定回调 origin。
3. Token 必须包含唯一需要的 Picker scope。
4. 只有真实的 Picker `sessions.create` 成功后才显示“已连接”。
5. 授权后可以创建 standby session，让下一次 Picker 更快打开。
6. Standby session 只能原子消费一次，并使用 Google 返回的 `expireTime` 判断是否过期。
7. 切换账号或断开连接会关闭旧 Picker 并删除过时 session。
8. API 返回 `401` 时会清除被拒绝的 token；扩展不保存 refresh token。

## ChatGPT 附件注入原理

Content script 不依赖随机生成的 CSS class，而是依次尝试：

1. 查找语义明确的 `input[type=file]`，使用 `DataTransfer` 设置文件；
2. 观察动态插入的 file input；
3. 使用标准 Drag & Drop 事件交接文件；
4. 验证 ChatGPT 附件界面是否出现响应。

ChatGPT 是持续变化的第三方 SPA，未来 UI 更新仍可能需要适配。

## 存储与保留时间

| 数据 | 保存位置 | 保留时间 |
|---|---|---|
| 账号选择器短期 access token | `chrome.storage.session` | 当前浏览器会话、断开连接或 token 被拒绝前 |
| Picker session / job 元数据 | `chrome.storage.session` | 当前浏览器会话或任务清理前 |
| 用户主动断开连接偏好 | `chrome.storage.local` | 重新连接或卸载前 |
| 所选照片 bytes | 浏览器内存 | 仅当前传输期间 |
| Client ID 与扩展公钥 | 源码和构建产物 | 公开应用身份 |

扩展不会在持久化 extension storage 中保存 Google 密码、Client Secret、refresh token、私钥或照片 bytes。

## 用户控制

- **选择其他 Google 账号**会打开 Google 官方账号选择器，并丢弃旧 standby session。
- **断开 Google 相册**会清理本地授权状态，并在可用时请求 Google 官方 endpoint 撤销 token。
- 关闭 Picker 会取消当前选择并触发 session 清理。
- 卸载扩展会删除其本地 extension storage。
- 用户也可以在 Google 账号安全设置中查看或撤销访问权限。

## 安全审查边界

仓库公开完整源码与可审查的 `dist/`。生产构建使用 Manifest V3 和仅允许本地脚本的 extension Content Security Policy。贡献者和试用者绝不能在 GitHub Issue 中公开真实 access token、私人 Google Photos URL、个人文件名、账号截图或 credentials。

更多信息见 [中文隐私政策](../PRIVACY.zh-CN.md)、[中文安全政策](../SECURITY.zh-CN.md) 和 [troubleshooting.md](../troubleshooting.md)。
