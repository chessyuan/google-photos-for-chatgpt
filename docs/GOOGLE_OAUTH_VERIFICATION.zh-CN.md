# Google OAuth 正式发布与验证清单

[English](GOOGLE_OAUTH_VERIFICATION.md)

编制日期：2026 年 8 月 16 日

## 当前状态：需要项目所有者继续处理

本仓库和正式构建可以证明扩展的客户端行为、固定 Extension ID、公开 OAuth Client ID 和请求的 scope，但无法读取 Google Cloud Console 中只有项目 Owner / Editor 才能确认的状态。

目前仍需在 Google Cloud Console 核实：

- Audience 是 External 还是 Internal；
- Publishing status 是 Testing 还是 In production；
- Branding 是否已经验证并发布；
- `photospicker.mediaitems.readonly` 在控制台中的数据访问分类；
- 该 scope 的 OAuth verification 状态；
- 是否仍有 Test User 或未验证用户数量限制；
- Chrome Web Store 是否存在与 `igacbcmbkglkglkindhcpmagafnboolj` 对应的项目。

在这些事项完成前，Google 可能显示“Google 尚未验证此应用”、测试状态提示，或者拒绝未加入 Test Users 的账号。这是 Google OAuth 项目状态造成的限制，扩展不会绕过或伪装它。

## 已从源码与构建确认

- 应用名：**Google Photos for ChatGPT**；
- 仓库：<https://github.com/chessyuan/google-photos-for-chatgpt>；
- 固定 Extension ID：`igacbcmbkglkglkindhcpmagafnboolj`；
- Chrome Extension OAuth Client ID：`43154637059-a8t1kbv88cv9kj51edigsluh0gkbvn2m.apps.googleusercontent.com`；
- 账号选择器 Web OAuth Client ID：`43154637059-t2no9fsmb7rmn2pnd1d6p6dlvroga1q0.apps.googleusercontent.com`；
- 回调 URI：`https://igacbcmbkglkglkindhcpmagafnboolj.chromiumapp.org/`；
- 唯一 Google Photos scope：`https://www.googleapis.com/auth/photospicker.mediaitems.readonly`；
- 没有旧 `photoslibrary.readonly`、Client Secret、refresh token、自建 token backend、分析或遥测。

OAuth Client ID 和 manifest 公钥是客户端公开标识，不是密码。真正的 Secret、token、私钥和 credentials 文件不得进入仓库。

## Google Cloud 所有者操作清单

所有截图或导出文字都应记录日期并脱敏；不要公开 token、Client Secret、私钥或账号隐私。

1. 打开拥有上述生产 Client ID 的 Google Cloud 项目。
2. 在 **Google Auth Platform → Audience** 确认 **External**。
3. 检查 **Publishing status**。Testing 状态只允许配置过的 Test Users；准备公开后按 Google 要求切换到 **In production**。
4. 在 **Branding** 中设置并核对：
   - App name：`Google Photos for ChatGPT`；
   - 用户支持邮箱；
   - 与仓库一致的应用说明；
   - 维护者拥有并可验证的主页、隐私政策和条款域名；
   - 开发者联系邮箱。
5. 在 Google Search Console 验证所有生产 OAuth 页面使用的域名。
6. 在 **Data Access** 中只声明 `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`，并移除本应用不使用的旧 Photos Library scope。
7. 记录控制台对该 scope 显示的真实分类，不根据博客或源码推测。
8. 在 **Clients** 中核对 Chrome Extension Client 对应的项目 ID 恰好是 `igacbcmbkglkglkindhcpmagafnboolj`。
9. 在 Chrome Web Store Developer Dashboard 核对存在相同 Extension ID 的项目。
10. 发布 Branding，并按控制台要求完成 Brand Verification。
11. 在 **Verification Center** 提交 Photos Picker scope 的 Data Access verification，提供 scope 理由、评审步骤、连续演示视频和截图。
12. 关注支持邮箱与开发者邮箱，及时回复 Google 审核团队。
13. 审核完成后保存以下证据：External、In production、Branding 已验证/发布、scope 已批准、普通账号不再受 Test User 限制。
14. 使用一个从未加入 Test Users 的全新 Google 账号测试：安装候选构建、授权、打开 Picker、选择一张照片、点击完成并确认照片进入 ChatGPT。

只有完成以上核验后，才应移除 README 中的发布门槛并把 v1.1.0 描述为面向普通 Google 账号公开可用。

## Scope 使用理由

请求的权限：

```text
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
```

建议提交文字：

> Google Photos for ChatGPT 使用该 scope 创建、读取和删除 Google Photos Picker session，并列出用户在该 session 中明确选择的媒体项目。扩展随后从 Google 提供的 URL 把所选照片 bytes 读入浏览器内存，并交给用户当前的 ChatGPT 附件界面。没有这个 scope，扩展无法提供“从 Google Photos 选择照片并添加到 ChatGPT”的核心功能。扩展不需要访问用户的完整相册，因此不请求旧版或更宽泛的 Photos Library scope。

## 数据处理说明

> Google 用户数据只用于完成用户主动发起的选图操作。OAuth 通过 Chrome Identity 与 Google 官方 endpoint 完成。账号选择器模式的短期 access token 只在当前浏览器会话内保存在 `chrome.storage.session`，不会发送到项目自建服务器，也不会暴露给 ChatGPT content script。所选照片 bytes 只在浏览器内存中处理，并交给用户当前的 ChatGPT 页面；扩展不会在操作结束后保留它们。项目没有自建后端、分析、遥测、广告或用户数据销售。

## 审核人员操作步骤

1. 使用已登录且 Google Photos 中有测试照片的桌面 Chrome。
2. 安装 Chrome Web Store 审核项目，或安装固定 ID 为 `igacbcmbkglkglkindhcpmagafnboolj` 的相同未打包构建。
3. 打开 `https://chatgpt.com/` 并进入一个对话。
4. 点击 ChatGPT 输入框左侧的四色 Google Photos 图标。
5. 第一次使用时完成 Google 官方账号选择和 OAuth 授权。
6. 确认 consent screen 显示 **Google Photos for ChatGPT**，且只请求 Picker read-only 权限。
7. 确认首次授权后自动继续打开 Picker，不需要第二次点击扩展。
8. 选择一张或多张非敏感测试照片并点击“完成”。
9. 确认 Picker 关闭，照片进入 ChatGPT 附件区域。
10. 再次打开 Picker，确认有效授权不会重复要求 consent。
11. 在 Popup / Options 检查“已连接”“选择其他 Google 账号”“断开 Google 相册”和隐私政策链接。
12. 断开连接后再次点击图标，确认重新进入 Google 官方授权流程。

## 演示视频与截图

演示视频应尽量一次连续录制，并保持地址栏可见：

- 展示项目主页、隐私政策、条款和支持入口；
- 展示扩展详情页中的名称和固定 ID；
- 展示未连接状态、Google 官方账号选择、完整 consent screen 与唯一 scope；
- 选择两张非敏感测试照片，点击完成，并展示两张照片进入 ChatGPT；
- 展示第二次打开不重复授权；
- 展示选择其他账号和断开连接；
- 最后说明数据流：Google OAuth / Picker → 浏览器内存 → 当前 ChatGPT 页面；没有自建后端、分析、遥测或密码收集。

截图至少包括：主页、英文与中文隐私政策、条款、扩展 ID、未连接状态、consent screen、Picker、ChatGPT 附件、已连接状态、账号切换/断开按钮、Google Cloud Audience、Branding、Data Access / Verification Center 和匹配 ID 的 Chrome Web Store 项目。

录制与截图中不得出现真实 token、私人文件名、个人照片、邮箱内容、Cloud credentials 或无关浏览器数据。

## 公开文档

- 项目主页：<https://github.com/chessyuan/google-photos-for-chatgpt>；
- [中文隐私政策](../PRIVACY.zh-CN.md)；
- [English Privacy Policy](../PRIVACY.md)；
- [中文服务条款](../TERMS.zh-CN.md)；
- [中文安全政策](../SECURITY.zh-CN.md)；
- [OAuth、隐私与技术原理](OAUTH_PRIVACY_AND_ARCHITECTURE.zh-CN.md)。

正式 OAuth 验证通常需要稳定且由维护者拥有、可验证的自定义域名。提交前应在控制台中填写真实的支持邮箱、开发者邮箱和已验证域名；这些个人或后台配置不应硬编码进仓库。

## 官方参考

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google Photos API authorization scopes](https://developers.google.com/photos/overview/authorization)
- [Manage app audience and publishing status](https://support.google.com/cloud/answer/15549945)
- [Submit an app for OAuth verification](https://support.google.com/cloud/answer/13461325)
- [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness)
