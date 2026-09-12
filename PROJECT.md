# YouTube Study Panel 项目文档

> **项目路径**：`D:\obsidian文件夹\jake的obsidian\AI\project\YouTubeStudyExtension`（2026-09-07 自 `AI\chatgpt\` 迁入，符合新项目目录规范）
> **当前版本**：v1.0.7（2026-09-09）
> **定位**：个人开发的 YouTube 英语学习浏览器扩展（Chrome/Edge，Manifest V3），对标 Language Reactor 的核心精听工作流，轻量、本地优先、可分享分发。
> **仓库**：github.com/Jake-gong/youtube-study-panel

> 本文档是项目的**开发与架构文档**，随项目一起维护；面向使用者的功能说明见 [README.md](./README.md)，隐私说明见 [PRIVACY.md](./PRIVACY.md)。

---

## 一、项目概览

一个为 YouTube 增加互动字幕学习面板的浏览器扩展。核心价值链：**句级字幕 → 精确播放控制 → 视频画面内点词查义 → 生词收藏导出**，覆盖 Language Reactor 在 YouTube 上最核心的学习场景，且：

- **本地优先**：字幕数据只在浏览器本地处理；默认查词仅发送单个单词给免费词典
- **免费可用**：不开箱付费、不绑定作者服务器、不需要注册
- **分享友好**：三种查词方式按需选择，使用者可完全离线（本地词典）或自带 AI Key

---

## 二、功能全景（v0.7.0）

### 字幕面板与播放控制
- 播放器左下角 `Study` 开关；右侧可折叠面板，按完整句子显示字幕（自动合并跨时间片的句子）
- 当前句高亮自动跟随；点击字幕跳转播放；滚动后可一键恢复跟随
- 单句循环（双击/↻ 按钮）；A-B 片段循环（进度条可拖拽标记、按视频记忆、与单句循环互斥）
- `0.25×–2.00×` 调速（0.05 步长），可选记忆
- 字幕下载 SRT / VTT / TXT

### 视频内嵌字幕（v0.4.0+）
- 当前句以绿色字幕叠加在视频画面上，自动跟随、句间隐藏（LR 同款交互）
- 悬停出现 ↻ 重播 / ☆ 收藏按钮；开启时自动隐藏 YouTube 原生 CC
- Study 面板关闭时 overlay 同步隐藏并恢复原生 CC

### 查词（三种方式，设置里三选一，链路：本地 → AI → 免费）
| 模式 | 悬停 | 点击 | 网络 |
|---|---|---|---|
| 免费词典（默认） | 英文简明释义+音标 | 原句上下文高亮、词义按上下文排序、释义例句 | dictionaryapi.dev，每词一次，缓存 |
| AI 大模型（v0.6.0） | AI 中文简明释义 | AI 结合原句三段式讲解（在本句中/其他含义/例句） | 使用者自己的 Key，缓存后零重复 |
| 本地词典（v0.7.0） | 中文释义+音标，毫秒级 | 原句+完整中文释义 | **零请求，完全离线** |

- 悬停 150ms 防抖、卡片立即显示 loading 再填充；点击自动暂停播放
- 词形回推（running→run、stopped→stop、jumps→jump）；AI/词典缓存均持久化
- AI 失败自动回退免费词典；本地未收录自动回退在线

### 收藏与导出
- 右键字幕句 / 悬停 ☆ / R 键 / 词典卡内按钮收藏（自动带原句、视频、时间点）
- 生词本视图：回跳原视频时间点、单条删除、清空
- 导出 CSV（Excel）和 Anki TSV（含来源链接）

### 学习模式
- 逐句自动暂停（Q）：每句播完即停，seek/开播不误触发，循环时让位
- 字幕隐藏/模糊模式（E）：侧边栏与视频字幕同步模糊，悬停显示

### 快捷键
| 键 | 功能 |
|---|---|
| `A`/`S`/`D` | 上一句 / 重播当前句 / 下一句 |
| `W` | 播放/暂停　`Q` 自动暂停　`E` 隐藏字幕　`R` 收藏当前句 |
| `Shift+C` | 复制当前句（Markdown + 时间戳链接） |
| `Shift+A/B/L/X` | A-B 循环设点 / 开关 / 清除 |
| `Esc` | 关闭词典卡片 |

---

## 三、技术架构

### 文件结构
```
manifest.json          MV3；权限见下
content.js             页面交互、字幕解析、设置与存储协调
page-bridge.js         MAIN world，document_start，拦截播放器请求
styles.css             面板 + overlay + 弹窗样式
study-core.js          纯字幕分页与 AI 请求生命周期（先于 content.js 加载）
.test/                 冒烟、正式解析边界、可靠性回归及浏览器验收生成器
dict/zh-gloss.json     本地词典数据（2.2MB，3 万词）
scripts/build-local-dict.cjs   词典生成脚本（ECDICT→JSON）
```

### 关键设计
1. **字幕获取**：不直接请求 timedtext（有 PO Token 校验），而是 page-bridge 截获播放器自身的 fetch/XHR 并代为请求；支持 JSON3/VTT/XML 解析、词级时间戳、过期地址刷新、多级回退。
2. **短语重组**：`normalizeCues` 保留词级 segments，并用 `groupWordsIntoPhrases` 生成侧栏字幕段。人工整行保持原段；自动字幕通常约 12 词一段。
3. **视频字幕 overlay**：在同一播放器内用隐藏副本及逐词 span 实测两行容量；`study-core.js` 的 `paginateCue` 保留全部文本，优先使用分页边界的原生词时间，无匹配时间时按文本位置插值。字幕字号保持 0.038×播放器高度（15–30px），宽度或字体变化后重排。侧栏与查词/收藏保留原字幕段。
4. **自动暂停判定**："自然播放步长（≤2.5s）+ 进入新句"双条件，`play`/`seeking` 重置追踪器，杜绝误暂停。
5. **词典查询链**：本地模式未命中回退在线；AI 模式使用 `study-core.js` 的客户端，10 秒超时、按用途取消、并发去重。测试连接接收独立草稿配置，不更改运行时设置。AI 缓存区分接口、模型及详细查询上下文。
6. **存储布局**（全部 `chrome.storage.local`，已加 `unlimitedStorage`）：
   `youtubeStudySettings`（含 lookupMode/ai 配置）、`youtubeStudyVocab`（上限 5000）、`youtubeStudyRangeLoop:<videoId>`、`youtubeStudyDictCache`（800 词瘦身）、`youtubeStudyAiGlossCache`/`AiDetailCache`（2000/1000）、`youtubeStudyLocalDict`（整份词典）。

### 权限清单
`storage`、`unlimitedStorage`；host：`*.youtube.com`、`api.dictionaryapi.dev`、5 家 AI 预设域名、`raw.githubusercontent.com`。

---

## 四、AI 词典配置要点

- 预设：智谱 GLM（`glm-4-flash` **免费**，默认推荐）/ DeepSeek / Kimi / OpenAI / 通义千问 / 自定义（任意 OpenAI 兼容）
- 悬停 prompt：约束"一行中文简明释义"（max_tokens 60）；点击 prompt：严格三行"在本句中/其他含义/例句"（220）
- 设置界面：查词方式、服务商、接口地址、Key（password）、模型、测试连接
- 自定义接口需支持 CORS

## 五、本地词典要点

- 数据：ECDICT（MIT）66MB 全库 → 按词频取 top 30000 → `word: [音标, 释义]`（释义 ≤4 行 220 字，`\n` 字面转义）
- 重新生成：`node scripts/build-local-dict.cjs <ecdict.csv> [词数]`
- 安装三通道：包内 `dict/zh-gloss.json`（离线瞬装）→ GitHub raw → 文件导入

---

## 六、版本演进

| 版本 | 一句话摘要 |
|---|---|
| 0.1.x | 首版：面板、字幕截获（PO Token/多格式兼容演进） |
| 0.2.x | 整合 A-B 循环扩展：设点/拖拽/快捷键/按视频记忆；句级合并与词级对齐 |
| 0.3.0 | 学习工具套件：自动暂停、隐藏模式、点词查典、收藏导出、句子快捷键、Markdown 复制 |
| 0.4.0 | 视频内嵌绿色字幕（点词查义/重播/收藏），隐藏原生 CC |
| 0.5.0 | 悬停简明释义 + 点击详情（原句高亮/词义排序）+ 点击自动暂停 |
| 0.5.1 | 修复字幕轨意外锁中文：偏好只记手动选择，回退顺序优化 |
| 0.5.2 | 查词提速：150ms 防抖、loading 卡先行、并行候选、5s 超时、缓存持久化 |
| 0.6.0 | AI 词典（自带 Key，6 家预设，测试连接，缓存，失败回退） |
| 0.7.0 | 本地词典（一键下载/文件导入，3 万词离线秒查，三模式统一链路） |
| 0.7.1 | 设置界面重构：选项代码构建防丢失、选择即生效、按方式显示对应配置区 |
| 0.7.2 | 修复下拉弹出列表白字白底不可见：color-scheme dark + option 深色背景 |
| 0.7.3 | 词典卡片智能方向：下方空间不足自动向上展开，渲染后重定位 |
| 0.7.4 | 详情卡片移除"原句"摘录块，直接显示释义/分析 |
| 0.7.5 | 视频字幕滑动窗口：长句只显示当前词附近 ~14 词，CSS 限两行；侧边栏仍完整句 |
| 0.7.6 | 窗口容量提至每行 15 词（共 30），字幕框加宽至 94% |
| 0.7.7 | 视频字幕字号下调（每行词数翻倍）+ 两行自适应接续（超两行自动丢弃句首已读部分） |
| 0.7.8 | 字号恢复原版；接续解除窗口限制；窗口只向前滑动 + seeking 重算，消除互相覆盖 |
| 0.7.9 | 一次性清空 v0.5.1 前错误写入的非英语轨偏好（trackPrefCleaned 迁移） |
| 0.8.0 | 修复字幕错乱回归：离屏探针真实测量两行容量，替代被 padding/line-clamp 污染的 offsetHeight 判断；先算后渲染 |
| 0.9.0 | **架构重构：时间锚定短语块**——预切分（标点/连词断点、≤30 词/块、比例时间、区间连续化）+ 二分查找当前块；删除时间估词/探针测行/丢词/单调规则全部旧机制；overlay 交互经 chunk→sentence 映射 |
| 0.9.1 | 块长上限自适应：探针按当前字号/宽度实测每行词数，上限=每行×2（回退 30）；字号/尺寸变化自动重切 |
| 0.9.2 | **根因修复：overlay 实际宽度只有播放器一半**（abspos left:50%+translate 的可用宽度陷阱，max-width 从未生效）；改为 left/right 3% 真实占满 94%，text flex:1；探针宽度公式同步修正 |
| 0.9.3 | 视频字幕改单行：块上限=一行实测容量（回退 15 词），CSS line-clamp 1 |
| 1.0.0 | **架构对齐 LR：视频字幕显示单元改为原生分段**（normalizeCues 返回 {cues,segments}，分段时间精确、经 sentenceIndexForTime 映射到句）；超长分段字号自适应缩小（下限 65%）；删除句子切块子系统。句子合并仅保留给侧栏与完整句上下文 |
| 1.0.1 | 修正分段粒度误判：ASR json3 的原生事件是词级；groupWordsIntoPhrases 把词事件聚合为 5~12 词短语（标点/停顿/12 词切），侧栏与视频均以短语为单位、时间精确 |
| 1.0.2 | 自查修复：撇号分词拼接、缩写单独成短语两个边界 bug；新增 phrase-edge-cases.cjs；删死代码 sentenceIndexForTime |
| 1.0.3 | 修复跟随当前滚动偏差：offsetTop（相对定位面板）→ getBoundingClientRect 差值，当前句精确居中 |
| 1.0.4 | 字幕同步提速：短语切换由 timeupdate（~250ms 粒度）改为播放期 rAF 逐帧检测（~16ms），seek 即时刷新 |
| 1.0.5 | 真实两行布局分页（overlayMeasure/paginateCue，保留原字号，响应宽度与字体）；AI 超时/取消/去重；设置与工具栏精简 |
| 1.0.7 | 修复悬停释义被短语切换/自动滚动误杀：锚点存活检测（dropStale/refresh），滚动改重定位 |
| 1.0.6 | 修复切换滞后：dDurationMs 是显示时长导致相邻短语区间重叠、二分查找停在上一短语；词级+短语级结束时间钳制到后继开始，时间轴单调 |

详细实现过程的历史日志（v0.3.0–v0.7.0 逐版记录）保存在
`D:\obsidian文件夹\jake的obsidian\AI\GLM\YouTube-Study-Panel-v0.3.0-实现记录.md`。

---

## 七、开发与验证

```bash
node --check content.js                     # 语法
node .test/ab-loop-smoke.js                 # A-B 循环/字幕点击/按视频记忆
node .test/caption-bridge-smoke.js          # 字幕桥接/过期地址刷新
node .test/study-tools-smoke.js             # 学习工具全量（查词三模式/收藏/AI/本地词典）
```

- 测试为自研 DOM stub harness（无浏览器依赖），**已知坑**：stub 的 `textContent` 不自动聚合子节点（用 `deepText()` 递归取）；容器监听器收不到子元素 dispatch（需在容器上 dispatch 并传 target）；`appendCueWords` 对空格也生成 punct span（无查词键，选悬停目标时注意）。
- 调试方式：加载已解压扩展（chrome://extensions → 开发者模式），改完 content.js 后刷新 YouTube 页面。

## 八、发布与分享

1. 版本号：`manifest.json` + README 安装段 zip 名 + changelog 三处同步
2. 两种分发形态：
   - **完整包**（含 `dict/`）：开箱即离线词典，zip 约 +600KB
   - **精简包**（不含 `dict/`）：用户点"下载本地词典"从 GitHub 拉——**前提：`dict/zh-gloss.json` 已推送到仓库 main 分支**
3. 发布流程：GitHub Releases → 上传 zip → README 下载链接指向 latest
4. 隐私文件 PRIVACY.md 随包分发（已覆盖三种查词模式的数据流向）

## 九、后续路线图（按性价比）

1. **双语字幕**：timedtext 加 `&tlang=` 取译文轨，面板句子加第二行（不需要付费 API，下一个最高性价比项）
2. AI 讲解增强：多轮追问、整句语法讲解
3. 词典换源/多源并发（dictionaryapi.dev 国内不稳时的备用）
4. 导出增强：Obsidian Markdown 直接导出、Anki 一键调用
5. 原生 e2e 测试（Playwright）替代部分 stub 测试

## v1.0.5 验证与边界

- 运行：`node --check content.js`、`node --check study-core.js`，以及 `.test` 下 ab-loop-smoke.js、caption-bridge-smoke.js、study-tools-smoke.js、phrase-edge-cases.cjs、reliability.cjs。
- 本地浏览器验收：`python .test/build-browser-review.py`，随后从项目根目录启动本地 HTTP 服务，打开 `.test/.browser-review/index.html?v=review`。这使用真实代码和 CSS，但字幕、存储和网络是本地测试替身。
- 已通过 360/640/960/1280 宽度、英文长句、80 词、中文和超长单词共 16 组真实布局测试（73 页），无裁字、未缩字号。
- 已验证设置草稿提示与切换服务商清空 Key。尚未完成真实 YouTube 视频、全屏以及真实 AI 服务商网络验收。
- 手动字幕没有词级时间时分页时间仍为近似；不声称逐词同步。旧版演进记录中的单行与缩字号方案已由当前分页方案替代。
- 版本已更新源码；未创建 GitHub release。打包时必须包含 study-core.js。
