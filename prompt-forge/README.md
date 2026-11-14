# 提示词工坊 · Prompt Forge

一个跨平台桌面应用（Windows / macOS），把"一句粗糙的需求"改写成"可以直接交给 AI 执行的高质量提示词"。

输入一句话，选一个场景，点一下按钮——结果会**直接流式回填到输入框**，复制走或继续修改即可。全程本地运行，不经过任何中转服务器；模型调用由你自己的 API Key 直连厂商，密钥加密保存在操作系统凭据存储中。

---

## 一、应用简介

大多数人写不好提示词，不是因为不会打字，而是漏掉了执行者需要的信息：**任务的目标、约束、交付形态、质量标准**。补这些信息对人是负担，对模型是一次改写任务。

提示词工坊就是把这件"补齐"的事固化下来：

- **你只给需求**，它负责补上缺失的执行维度
- **它不替你做内容**——不列病名、不写章节大纲、不编素材，只补"怎么写"，不补"写什么"
- **输出形态受约束**：一段式正文、首句即任务、无前言无小节标题、60–180 字，可直接粘贴

设计目标是"增强"，不是"扩写"。同样一条输入，WorkBuddy 内置增强给出 110 字，本应用给出 79–109 字，形态接近；而早期版本会输出 386 字的领域大纲——这一点在 `electron/prompt.js` 的指令层里被专门约束，并有 30 项回归测试守着。

## 二、主要功能

### 增强主流程

- **一句话输入 + 一键增强**：`Ctrl/⌘ + Enter` 直接触发
- **流式输出**：首字延迟优先，边生成边显示，可随时停止
- **结果回填输入框**：不再是左右双栏比对着看，生成完就是可编辑的文本，附「还原原文」一键回到改前状态
- **6 套场景模板**：通用增强、写代码、文案写作、分析研究、翻译润色、角色设定。模板只影响"补哪些维度"，不影响讨论什么内容
- **两层输出兜底**：流式阶段扣住"你的需求信息量偏少……"这类元话语不显示；终稿再清洗分隔线、小节标题、代码块包裹

### 桌面端能力

- **全局唤起**：默认 `Ctrl/⌘ + Shift + P`，在任意软件里按下即唤出窗口并自动读入剪贴板内容
- **剪贴板增强**：复制一段文字 → 按热键 → 直接改写
- **托盘常驻**：关闭窗口不退出，托盘右键可唤起、设置、退出
- **开机自启**：可选开关
- **系统原生通知**：长任务完成时提示

### 模型与配置

- **多厂商支持**：DeepSeek、通义千问、智谱 GLM、Kimi、OpenAI，以及任意 OpenAI 兼容接口（自建服务、中转站、Ollama 均可）
- **自带 Key（BYOK）**：密钥经系统加密后落盘，界面上只回显 `sk-3f8a****c9d2` 形式的掩码，**明文永不进入渲染进程**
- **拉取模型**：直接请求接口的 `GET /models`，把真实可用模型列成胶囊，点一下填入，不必猜模型名
- **主界面下拉按需显示**：只列已配 Key 的服务商；没配 Key 的不会出现在下拉里，避免选到不可用的模型
- **快捷键全部可改**：4 个动作都能录制修改，全局热键会真正注册，被占用时提示并回滚
- **数据目录可迁移**：换到别的盘或同步盘，迁移带校验与 `.bak` 备份

### 历史记录

- 本地保存最近 500 条（原文 + 增强结果 + 模型 + 模板 + 时间）
- 支持搜索、复制、单条删除、清空

## 三、技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Electron 45（主进程 + preload + 渲染进程隔离） |
| 渲染层 | React 19 + TypeScript + Vite 8 + Zustand |
| 样式 | 原生 CSS（无 UI 框架、无 Tailwind，单文件变量体系） |
| 打包 | electron-builder（NSIS / DMG），另有免安装便携版脚本 |
| 存储 | 本地 JSON + 系统加密（Electron `safeStorage`） |
| 模型调用 | 原生 `fetch` + SSE 手写解析，无第三方 SDK |

选 Electron 而非 Tauri 的原因很实际：Tauri 需要 Rust 工具链与 MSVC 构建工具（2–4 GB、半小时以上），而本项目面向"个人自用 + 熟人分享"，用约 100 MB 的安装包体积换掉一整套编译环境依赖是划算的。渲染层与业务代码和外壳无关，将来要换 Tauri 只需替换 `electron/` 一层。

## 四、安装与运行

### 环境要求

- **Node.js 20 或更高**（推荐 22）
- Windows 10/11 或 macOS 12+
- 一块能访问所选模型接口的网络

### 从源码运行

```bash
git clone <your-repo-url> prompt-forge
cd prompt-forge
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器与 Electron，改前端代码热更新。

### 国内网络注意事项

Electron 的二进制文件从 GitHub 下载常常很慢或失败，装依赖时挂镜像：

```bash
# Windows (PowerShell)
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# macOS / Linux
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

如果 `npm install` 已经装完但启动报找不到 Electron，单独补下载：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

### 构建与打包

```bash
npm run build          # 只构建前端产物到 dist/
npm run preview        # 构建后直接以桌面应用方式运行
npm run portable       # 组装免安装便携版 → release/PromptForge-win-x64/
npm run dist:win       # 打 Windows 安装包（NSIS）
npm run dist:mac       # 打 macOS 安装包（DMG）
```

补充说明：

- `portable` 只是把 Electron 运行时和 `dist/`、`electron/` 拼在一起，**不需要联网**，适合网络受限时出可运行产物
- `dist:win` / `dist:mac` 需要 electron-builder 下载 `winCodeSign`、`nsis` 等组件；网络不通时可用 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- **macOS 产物必须在 macOS 上构建**，不能交叉编译

### 开发与测试脚本

```bash
npm run typecheck      # tsc --noEmit
npm run test:prompt    # 提示词指令层回归测试（30 项断言）
npm run icons          # 由 tools/gen-icon.mjs 重新生成应用与托盘图标
npm run ab -- --input="你的输入" --template=writing   # 新旧指令 A/B 对照
```

## 五、使用方式

### 第一次使用

1. 启动应用，点右上角「设置」
2. 在「模型服务」里选一家厂商，粘贴 API Key，点「保存」
3. 点该行的「拉取模型」，从返回的模型里选一个（也可以直接用默认）
4. 返回主界面，输入框右下角就会出现该服务商和模型

### 日常使用

```
输入一句话 → 选场景胶囊（可选）→ 点右下角四角星（或 Ctrl/⌘ + Enter）
          → 结果流式回填 → 复制 / 继续改 / 还原原文
```

- 想更快的路径：在任意软件里选中或复制一段文字，按 `Ctrl/⌘ + Shift + P`，窗口会带出剪贴板内容，再按一次增强
- 历史页可以回看之前的增强结果，也可以把它们复制走

### 默认快捷键

| 动作 | 默认组合 | 说明 |
|---|---|---|
| 全局唤起 | `Ctrl/⌘ + Shift + P` | 任意软件内唤出窗口并读入剪贴板 |
| 开始增强 | `Ctrl/⌘ + Enter` | 输入框内直接生成 |
| 复制结果 | `Ctrl/⌘ + Shift + C` | 复制当前内容（开启自动复制时生成完也会自动写入剪贴板） |
| 清空输入 | `Ctrl/⌘ + Shift + K` | 一键重来 |

四个都能在「设置 → 快捷键」里点一下后直接按键重录，`Esc` 取消，必须带修饰键。

> macOS 上 `Ctrl` 实际显示为 `⌘`（`CommandOrControl` 的语义），Windows 上是 `Ctrl`。

## 六、配置说明

### 配置存放位置

应用不读取项目目录里的任何配置文件，所有配置都在系统 userData 下：

| 系统 | 默认路径 |
|---|---|
| Windows | `%APPDATA%\prompt-forge\` |
| macOS | `~/Library/Application Support/prompt-forge/` |

目录内四个文件：

| 文件 | 内容 | 是否明文 |
|---|---|---|
| `settings.json` | 服务商、模型、温度、模板、快捷键、数据目录外的全部偏好 | 明文 |
| `keys.json` | 各服务商的 API Key | **加密**（`safeStorage`，绑定当前用户账户） |
| `history.json` | 最近 500 条历史记录 | 明文 |
| `location.json` | 数据目录指针（改了存储位置才会出现） | 明文 |

字段含义见 [`docs/settings.example.json`](docs/settings.example.json)，那是一份可参考的空白配置（不含任何凭据）。

`settings.json` 主要字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `providerId` | string | 当前服务商 id，如 `deepseek` / `custom` |
| `model` | string | 当前模型名（内置服务商用） |
| `temperature` | number | 温度，运行时会被钳制到 ≤ 0.4，建议 0.2–0.4 |
| `templateId` | string | 默认场景模板 |
| `autoCopy` | boolean | 增强完成后自动复制到剪贴板 |
| `hotkey` / `hotkeyEnhance` / `hotkeyCopy` / `hotkeyClear` | string | Electron accelerator 格式 |
| `openAtLogin` | boolean | 开机自启 |
| `customBaseUrl` | string | 自定义接口地址，如 `https://api.example.com/v1` |
| `customModel` | string | 自定义接口的模型名 |
| `providerModels` | object | 各服务商「拉取模型」得到的真实模型名，优先于内置列表 |

### Key 是如何保管的

- 通过 Electron `safeStorage` 加密后写入 `keys.json`，密钥材料由操作系统保管（Windows DPAPI / macOS Keychain）
- 渲染进程只能拿到掩码，`preload` 暴露的 IPC 里没有任何"把明文 Key 读出来"的通道
- 因此：**换电脑、换系统账户、或手工搬运 `keys.json` 到别的机器，Key 都解不开**，需要重新填写

### 修改数据存储位置

「设置 → 数据存储 → 选择文件夹并迁移」。迁移顺序是刻意设计的：

1. 创建目标目录
2. 检查目标目录里是否已有同名数据（有则直接拒绝，避免覆盖）
3. 探测可写
4. 复制三个数据文件
5. 逐字节校验大小
6. 写入 `location.json` 指针
7. 旧文件改名为 `.bak-<时间戳>` 留底
8. 切换生效

任何一步失败都保持原状，不会出现"指针指过去、数据没过去"。只搬三个 json，**不搬整个 userData**——因为 `safeStorage` 的密钥材料在 userData 里，整体搬走会导致密钥解不开。

## 七、目录结构

```
prompt-forge/
├── electron/               主进程（Node 侧，拥有全部系统能力）
│   ├── main.js             窗口、托盘、全局热键、IPC、增强调度
│   ├── preload.js          contextBridge 白名单，渲染层唯一入口
│   ├── providers.js        服务商注册表、SSE 流式解析、错误映射、/models
│   ├── prompt.js           指令层：模板、few-shot、输出清洗、流式守卫
│   └── store.js            配置/密钥/历史读写，数据目录迁移
├── src/                    渲染层（React）
│   ├── pages/              Home（主界面）、History、Settings
│   ├── components/         HotkeyField（快捷键录制）
│   ├── lib/                store（Zustand）、types、hotkeys
│   ├── App.tsx             顶栏 + 覆盖式页面切换
│   └── styles.css          全部样式
├── build/                  应用与托盘图标（由 npm run icons 生成）
├── docs/
│   └── settings.example.json   空白配置示例（无凭据）
├── tools/
│   ├── gen-icon.mjs            生成 PNG 图标
│   ├── make-portable.mjs       组装免安装版
│   ├── mock-provider.mjs       本地假接口，用于离线联调
│   ├── test-prompt.cjs         指令层回归测试
│   ├── test-migrate.cjs        数据迁移回归测试
│   ├── ab-run.cjs              新旧指令 A/B 对照
│   └── prompt-baseline.cjs     旧指令快照（对照组基准）
├── electron-builder.yml    打包配置
├── vite.config.mts
├── tsconfig.json
└── package.json
```

进程分工一句话：**渲染层只管界面，一切文件、密钥、网络、窗口能力都走 IPC 到主进程**。`nodeIntegration: false` + `contextIsolation: true`，渲染层拿不到 Node。

## 八、注意事项

### 费用与额度

- 本应用不代付、不转发、不内置任何 Key。**调用费用由你自己的厂商账户承担**
- 增强一次提示词大约消耗一千多个 token，按当前国产模型价格约几厘钱；充 10 元通常够个人用上千次
- 想控制成本，可在厂商后台设置消费限额

### 密钥安全

- 不要把 API Key 写进代码、截图、Issue 或提交记录。本仓库的 `.gitignore` 已排除 `settings.json`、`keys.json`、`*.bak-*` 等文件
- 如果你的 Key 曾经泄露（例如贴进过聊天窗口），请立刻到厂商后台吊销并重建
- Key 是**分服务商独立存储**的，内置厂商与"自定义"互不相通；换一行用需要重新填

### 模型名必须先确认真实名称

`HTTP 400` 报错里出现 `is not a valid model` / `The supported API model names are ...`，说明模型名与接口不匹配。点设置里的「拉取模型」，用接口真实返回的名字，不要凭印象填。

### Windows 上的两个坑

- **未签名安装包**：首次运行会被 SmartScreen 拦。要么买代码签名证书，要么让使用者点"更多信息 → 仍要运行"。用 `--dir` 出的免安装目录版同样会被拦
- **`ELECTRON_RUN_AS_NODE=1` 环境变量**：如果在 shell 里全局设了这个变量，从命令行启动会退化成 Node 运行并报 `getPath` 错误。启动前 `unset ELECTRON_RUN_AS_NODE`，双击 exe 不受影响

### macOS 上的坑

未公证的 `.app` 会被 Gatekeeper 拦住，首次打开需要右键 → 打开，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/提示词工坊.app
```

正式分发建议准备 Apple Developer 账号做签名与公证。

### 单实例

应用使用单实例锁，重复启动只会唤起已有窗口。如果你在调试时发现"改了代码但界面没变"，先确认托盘里没有残留实例，或带上独立数据目录启动：

```bash
electron . --user-data-dir=/tmp/prompt-forge-test
```

### 隐私

- 除模型接口外，应用不向上报任何数据；没有埋点、没有崩溃上报、没有账号体系
- 历史记录只存在本地，删除应用数据目录即彻底清除
- 你的输入内容会发送给你所选的模型厂商，适用该厂商的隐私政策

### 增强效果的边界

- 输出质量取决于所选模型对指令的服从度。`deepseek-chat` 一类通用模型通常够用；推理型模型（如 `deepseek-reasoner`）反而更容易啰嗦
- 如果某个模型顽固地输出小节标题，可在 `electron/prompt.js` 的 `sanitizeOutput` 白名单里补它的标题格式
- 温度越高越发散，改写任务建议 0.2–0.4

## 九、许可

本项目未附带开源许可证文件。如需公开发布，请自行选择并添加（MIT / Apache-2.0 是常见选择），同时确认所用依赖的许可证兼容性。

---

**声明**：本项目为个人工具，与任何模型厂商无隶属关系。"提示词工坊"仅为本地界面外壳，模型能力由你所选的服务商提供。
