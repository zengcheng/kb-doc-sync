---
name: kb-doc-sync
version: 2.2.0
author: zengcheng
description: KB（Confluence）知识库双向同步工具。支持从 KB 下载文档为 Markdown（pull），也支持将本地 Markdown 上传为 KB 页面（push）。当用户提到 KB、Confluence、知识库相关的文档操作时触发。用户也可以通过 /kb-doc-sync 显式调用。
---

# KB 知识库双向同步工具

从 KB（Confluence）下载文档为 Markdown，或将本地 Markdown 上传到 KB。

## 何时使用本 Skill

满足以下**任一条件**即可触发：

- 用户提到关键词：KB、知识库、Confluence、wiki
- 用户粘贴了含 `kb.cvte.com` 或 Confluence 实例的链接
- 用户要求下载/提取/导出/备份文档
- 用户要求上传/推送/发布/同步文档到 KB

## 决策流程（必须严格按以下步骤执行）

收到用户请求后，按 Step 1 → Step 2 → Step 3 顺序执行。

### Step 1：判断操作类型

问自己：**用户想从 KB 获取文档，还是想把文档发到 KB？**

| 用户意图 | 操作类型 | 跳转 |
|---------|---------|------|
| 从 KB **获取**文档到本地 | **Pull（下载）** | → Step 2A |
| 把本地文档**发送**到 KB | **Push（上传）** | → Step 2B |

### Step 2A：执行下载（Pull）

**你需要**：用户提供的 KB 页面链接（URL）

**如果用户没给链接**：向用户询问「请提供要下载的 KB 页面链接」

**执行命令**：
```bash
npx git@github.com:zengcheng/kb-doc-sync.git pull "用户给的KB链接"
```

**完整示例**：
- 用户说：「下载 https://kb.cvte.com/pages/viewpage.action?pageId=123456」
- 执行：`npx git@github.com:zengcheng/kb-doc-sync.git pull "https://kb.cvte.com/pages/viewpage.action?pageId=123456"`

**到这里就完成了，无需继续。**

---

### Step 2B：执行上传（Push）

上传需要两个信息：**文件路径** 和 **父页面 ID**。按以下步骤获取：

#### Step 2B-1：确定文件路径

用户会告诉你要上传哪个文件。如果没有明确说，向用户询问。

#### Step 2B-2：读取文件，检查 frontmatter 中有没有 pageId

打开文件，看文件开头是否有如下格式的 frontmatter：

```yaml
---
pageId: "123456"
spaceKey: "ITKB"
...
---
```

**关键判断**：frontmatter 中有没有 `pageId` 字段？

| 情况 | 含义 | 跳转 |
|------|------|------|
| **有 pageId** | 文档来自 KB，是更新操作 | → Step 3A |
| **没有 pageId 或没有 frontmatter** | 本地新文档，是创建操作 | → Step 3B |

---

### Step 3A：上传已有文档（更新到 KB）

文件的 frontmatter 中**有 pageId**，说明文档是之前从 KB 下载的。

**执行命令**：
```bash
npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id <frontmatter中的pageId> <文件路径>
```

**参数说明**：`--parent-page-id` 的值就是 frontmatter 中的 `pageId` 字段。

**完整示例**：
- 用户说：「帮我把 docs/运维手册.md 同步回 KB」
- 你读取文件，发现 frontmatter 中 `pageId: "495131893"`
- 执行：`npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id 495131893 docs/运维手册.md`

---

### Step 3B：上传新文档（在 KB 创建新页面）

文件中**没有 pageId**，说明是本地新建的文档。你需要知道把它创建到 KB 的**哪个页面下**。

**获取父页面 ID 的方法**（按优先级）：

1. 用户给了 KB 链接 → 从 URL 中提取 pageId
   - 例：`https://kb.cvte.com/pages/viewpage.action?pageId=495131888` → 父页面 ID = `495131888`
2. 用户说了父页面 ID → 直接使用
3. 用户什么都没给 → **必须询问**：「请提供目标父页面的链接或 ID」

**执行命令**：
```bash
npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id <父页面ID> <文件路径>
```

**完整示例**：
- 用户说：「把 /tmp/guide.md 上传到 https://kb.cvte.com/pages/viewpage.action?pageId=495131888 下面」
- 从 URL 提取父页面 ID = `495131888`
- 执行：`npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id 495131888 /tmp/guide.md`

**注意**：如果父页面下已有同名子页面，命令会跳过。加 `--update` 可强制覆盖。




## 前置条件

- Node.js >= 16
- 首次运行会自动安装 Playwright 和 Chromium（约 150MB）
- 认证方式：
  - 默认 Cookie 模式：首次自动打开浏览器登录，后续自动复用
  - 可选 Token 模式：设置环境变量 `KB_TOKEN`

## 快速参考

| 操作 | 命令 |
|------|------|
| 下载 | `npx git@github.com:zengcheng/kb-doc-sync.git pull "<KB链接>"` |
| 更新已有页面 | `npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id <pageId> <file>` |
| 创建新页面 | `npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id <父页面ID> <file>` |
| 强制覆盖同名 | `npx git@github.com:zengcheng/kb-doc-sync.git push --parent-page-id <父页面ID> --update <file>` |
