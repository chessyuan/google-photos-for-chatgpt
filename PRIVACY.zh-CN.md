# 隐私政策 — Google Photos for ChatGPT

最后更新：2026 年 8 月 15 日

Google Photos for ChatGPT 是独立开源浏览器扩展，与 Google 或 OpenAI 不存在隶属、背书、赞助或官方合作关系。

## 摘要

本扩展没有自建后端、分析、广告或遥测。它通过 Chrome Identity 和 Google OAuth，让用户在 Google Photos 官方选择器中主动选择照片。只有用户明确选择的照片会在浏览器中处理，并随后交给 ChatGPT。

## Google 授权

- 授权由 Chrome `chrome.identity` API 和 Google OAuth 服务完成。
- 扩展绝不会要求用户在扩展中输入 Google 密码。
- Google Photos 权限只有 `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`。
- 此 scope 允许扩展创建、查询和删除 Picker session，并读取用户在该 Picker session 中明确选择的媒体项目。
- OAuth access token 由 Chrome Identity 管理。扩展不会向普通用户显示 token，不会把 token 发送到项目自建服务器、写入仓库文件、`chrome.storage`、`localStorage` 或 Downloads。
- “断开 Google 相册”会清理本扩展的 Chrome Identity 授权状态，并且只保存一个非敏感的断开连接布尔偏好，防止用户重新连接前继续后台预热。

## 照片数据

- 扩展只访问用户在 Google Photos 官方选择器中主动选中并返回的媒体项目。
- 所选媒体 bytes 从 Google 提供的媒体地址直接进入浏览器内存。
- 媒体会短暂表示为 `Blob` 和 `File`，然后交给当前 ChatGPT 附件界面。
- 扩展不会主动把所选照片保存到 Downloads 或项目自建服务器。
- 扩展不会把照片用于广告、分析、画像、模型训练或与用户操作无关的用途。

## 临时扩展数据

`chrome.storage.session` 可能短暂保存 Picker session ID、过期时间、轮询配置、窗口/标签 ID、传输元数据、文件名、MIME type、任务状态、警告和性能时间点，用于 Manifest V3 Service Worker 休眠恢复。浏览器会话结束后这些数据会清空。

`chrome.storage.local` 只保存用户主动断开连接的状态偏好；不会保存 OAuth token、图片 bytes、Google 密码或 Google 账号凭据。

## 数据流向

扩展会与以下服务通信：

- Google OAuth / Chrome Identity：完成授权。
- `photospicker.googleapis.com`：管理 Picker session 并列出用户明确选择的项目。
- Google 提供的媒体 host：获取所选照片 bytes。
- `chatgpt.com`：把所选文件交给用户当前打开的 ChatGPT 对话。

项目维护者不会收到这些数据，因为项目没有自建后端。Google 和 OpenAI 会依据各自条款和隐私政策处理其服务中的数据。

## 保留与删除

- OAuth token 按 Chrome / Google 的机制保留在 Chrome Identity 缓存中，用户可以通过“断开 Google 相册”清理。
- 扩展会在完成、取消、过期或失败后尽力删除 Picker session；Google 也会在服务器端使 session 过期。
- 图片 bytes 只在当前内存传输期间存在，操作结束或浏览器上下文结束后不会由扩展保留。
- `chrome.storage.session` 临时数据随浏览器会话结束而清空。
- 用户重新连接或卸载扩展会移除断开连接偏好的影响。

## 安全

生产扩展使用 Manifest V3 和仅允许本地脚本的扩展页面 Content Security Policy，不加载远程可执行代码。源码和生产构建均可在本仓库公开审查。

请勿在公开 Issue 中粘贴 access token、私人照片链接、账号信息或个人文件名。安全问题请按 [SECURITY.md](SECURITY.md) 报告。

## 政策更新

实质性变化会记录在仓库中，并更新“最后更新”日期。影响 Google 用户数据用途的改动也可能需要在发布前重新完成 OAuth 审核。

## 联系方式

一般非敏感问题可在 <https://github.com/chessyuan/google-photos-for-chatgpt/issues> 提交 Issue。安全敏感问题请查看 <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/SECURITY.md>。
