# Aurora FM · dsh-ai-radio

一个运行在 **DeepSeek Harness / DSH Desktop** 里的私人 AI 电台。登录网易云、选择歌单、按下播放，主持人会根据音乐、天气、时间、收听历史和当天新闻持续编排节目。

**0.1.1 修复**：解决启用时出现 `pending (waiting for services: required, optional)` 的问题。已在 DSH Desktop 2.0.18 中实际安装并确认插件状态为 `active`。已安装 0.1.0 的用户请更新插件后**完整退出并重新启动 DSH Desktop**；仅开关插件或刷新界面不能清除后台进程缓存的旧模块。

![Aurora FM](docs/screenshot-desktop.png)

## 已实现

- **网易云账号与歌单**：App 扫码登录，或导入自己的 Cookie；读取创建、收藏和“我喜欢的音乐”，批量补全大歌单；可选择多个歌单组成曲库。
- **真实曲库选歌**：AI 只能返回曲库中的歌曲 ID；参考歌曲、歌手、专辑、歌单、网易云最近一周历史及本地播放/跳过/喜欢记录。避免近期重复；不可播放的曲目暂时跳过。
- **上下文主持**：当前时区报时、Open-Meteo 当天与当前天气、关注话题、额外文本、三种主持人格；开场、接歌、简短音乐介绍、新闻与轻松一刻。
- **当天新闻**：RSS 按需刷新，默认中新网与科技资讯源，支持自定义 RSS；检查当前时区当天的发布时间、过滤未来消息、跨源标题去重；正文保留媒体来源和原文链接。没有可靠新消息时不编造新闻。
- **声音切换**：系统浏览器音色（无需密钥）、OpenAI 兼容 TTS、Fish Audio；可设置音色、语速，提供试听，按音色缓存生成音频。
- **持续节目**：提前生成下一批节目、提前载入下一首音乐和下一段口播；双播放器等功率 crossfade；主持讲话时音乐自动 ducking，讲话结束平滑恢复。
- **恢复与控制**：暂停/继续、下一首、停止、点歌、锁屏媒体控制、播放进度恢复；跨标签页播放锁；取链失败、音频卡顿、AI/TTS/天气/新闻失败时重试或降级；插件卸载清理资源。
- **DSH 原生接入**：Host 路由、Web UI slots、`ai_radio` 模型工具；直接使用 DSH 已配置的文字模型，也可配置独立兼容接口。

## 安装到 DSH

需要 Node.js 20.19+，以及支持 `webServer`、UI slots 与 `llm.stream` 的 DSH Web / Desktop。

### DSH Desktop 安装（推荐）

在 DSH Desktop 中打开 **插件 → 添加插件**，输入 `github:txpoki/dsh-ai-radio#main`，或本地安装包 `dsh-ai-radio-0.1.1.tgz` 的完整路径。安装后启用；升级已有版本后完整退出并重新启动 DSH Desktop。

`desktop` profile 由 Electron 应用管理，请使用应用自带的插件管理器；命令行会拒绝直接修改它。

### Web / 命令行 profile：本地目录安装

```powershell
git clone https://github.com/txpoki/dsh-ai-radio.git
cd dsh-ai-radio
pnpm install
pnpm build
dsh plugin --profile web add link:C:/完整路径/dsh-ai-radio
```

将 `web` 改成你的实际命令行 profile。重启 DSH 后，聊天输入区下方会出现 Aurora FM 播放条。

### Web / 命令行 profile：从 GitHub 仓库安装

```sh
dsh plugin --profile web add "github:txpoki/dsh-ai-radio#main"
```

仓库现已公开；从 GitHub 安装需要本机已安装 Git 并加入 PATH。构建后的 `lib/client.js` 已提交，不需要用户在安装后额外编译。升级时按 DSH 自身的插件更新流程操作。

## 第一次开台

1. 打开 **我的歌单**，使用网易云音乐 App 扫码；勾选歌单，点击“用这些歌单开台”。
2. 打开 **电台设置**，确认城市、时区、主持人格及音色。DSH 模式会从已配置提供方中选择可用文字模型，也可以手动选择。独立预览使用外部接口模式。
3. 在“正在收听”点击播放。这次点击用于解锁浏览器音频；之后自动续播。
4. 给“补充信息”写下今天的状态或希望，例如：“今天写代码，少说一点，偏舒缓的歌”。

系统音色取决于操作系统和浏览器安装的声音。如果没有合适的中文声音，可切换兼容 TTS 或 Fish。不同服务的音色名称与模型由服务商实际支持情况决定。

### 在 DSH 对话中控制

模型工具 `ai_radio` 的动作：`play`、`pause`、`resume`、`next`、`stop`、`request`。

```json
{"action":"request","query":"想听歌单里的周杰伦，接下来少说一点"}
```

首次音频播放仍需点击 UI；点歌范围为所选歌单，不会自动加入未知音源。

## 本地预览与开发

```sh
pnpm install
pnpm build
pnpm dev       # http://127.0.0.1:4173，真实登录与配置
pnpm demo      # 同地址，演示歌单、合成测试音频、演示资讯
pnpm test
pnpm check
pnpm test:browser
```

预览默认仅监听 127.0.0.1，不会打开公网访问。`pnpm demo` 是明确标注的演示模式：曲名、歌手、天气和新闻均为演示数据，音乐为程序合成，口播为测试提示音。它验证播放器与 UI，不代表真实网易云或 TTS 已连接。

浏览器测试使用 Playwright，自动查找本机 Chrome/Edge，或使用 `RADIO_BROWSER_EXECUTABLE` 指定可执行文件。无本机浏览器时先运行 `pnpm exec playwright install chromium`。

## 数据与接口

- DSH 数据目录：`${DSH_HOME}/ai-radio`，未设置则是 `~/.dsh/ai-radio`。
- 本地预览：项目的 `.radio-data/local`。演示隔离在 `.radio-data/demo`。
- `AI_RADIO_DATA_DIR` 可覆盖目录；目录和状态文件以 0700/0600 创建，Windows 继承当前用户目录 ACL。
- Cookie 和 API Key 仅保存在 Host 状态中，不写入源码和 Git；配置查询返回 `hasKey`，不返回密钥。
- 历史最多 2000 条，主持口播最多 200 条；音频缓存位于内存，并有数量上限。
- 主要 API 在 `/dsh-ai-radio/` 下：`bootstrap`、`settings`、`login/qr`、`login/poll`、`playlists`、`library`、`context`、`plan`、`speech/prepare`、`event`、`history`。所有写请求使用 JSON 并验证同源。

结构与测试边界见 [docs/architecture.md](docs/architecture.md) 和 [docs/verification.md](docs/verification.md)。

## 使用边界

- “持续播放”需要 DSH Host 与播放页面保持运行，系统音频可用。关闭页面、设备睡眠、断网或平台侧限制不能由插件绕过。临时上游故障会重试；整库都不可播放时会退避等待，不制造假播放状态。
- 音乐按本人账号实际权限取链。只返回试听片段、无版权或取链失败的歌曲自动跳过，不做解灰或绕过付费权限。是否能播放某首 VIP 歌需要用实际账号验证。
- 开源软件不等于服务免费。DSH 模型、外部文字 API、OpenAI 兼容语音或 Fish 的费用由你配置的服务商决定。系统音色不需要插件额外 API Key。
- 新闻是按需刷新和按节目间隔插播，不是广播级紧急事件预警；未确认当天日期的条目不会播报。音乐掌故没有来源时，主持人只讲可从输入数据判断的氛围与衔接。
- 本仓库不会存储或分发完整歌曲文件，代码采用 MIT；第三方代码与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
