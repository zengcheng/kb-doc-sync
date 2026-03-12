---
name: kb-doc-sync
version: 2.1.0
author: zengcheng
description: KB（Confluence）知识库双向同步工具。支持从 KB 下载文档为 Markdown（pull），也支持将本地 Markdown 上传为 KB 页面（push）。当用户提到 KB、Confluence、知识库相关的文档操作时触发。用户也可以通过 /kb-doc-sync 显式调用。
---

# KB 知识库双向同步工具

从 KB（Confluence）下载文档为 Markdown，或将本地 Markdown 上传到 KB。

## 意图识别规则

当用户请求匹配以下任一条件时，使用本 Skill：

### 触发关键词
- **下载/提取类**：下载、提取、导出、备份、拉取、抓取、爬取
- **上传/同步类**：上传、推送、发布、同步、更新到、写入
- **平台关键词**：KB、知识库、Confluence、wiki

### 触发场景
- 用户粘贴了 `kb.cvte.com` 或其他 Confluence 实例的链接
- 用户提到要把某篇文档「放到 KB 上」「发到知识库」
- 用户说「帮我同步一下」并且上下文涉及 KB 文档
- 用户提到要修改 KB 上的某篇文档

## 场景识别与命令映射

收到用户请求后，按以下规则判断操作类型和参数：

### 场景一：下载（Pull）

**识别条件**：用户想从 KB 获取文档到本地

**参数提取**：
- 从用户提供的 URL 中提取链接
- 支持两种链接格式：`pageId=123456` 或 `/display/SPACE/Title`

**命令模板**：
```bash
node cli.js pull "<KB页面链接>"
```

**自然语言示例**：
- 「下载 https://kb.cvte.com/pages/viewpage.action?pageId=123456」
- 「帮我把这篇 KB 文档拉下来」
- 「导出一下知识库的运维手册」

---

### 场景二：上传已有文档（Push + 更新）

**识别条件**：
- 本地 Markdown 文件的 frontmatter 中**有 `pageId`** → 文档来自 KB
- 用户想把修改后的内容同步回去

**判断方法**：读取目标 .md 文件头部，检查是否有 `pageId` 字段。有 pageId 说明是从 KB 下载的文档，直接更新。

**参数提取**：
- `--parent-page-id`：从 frontmatter 的 `pageId` 获取（即文档自身的 pageId 就是父页面定位依据）
- 文件路径：用户指定的 .md 文件

**命令模板**：
```bash
node cli.js push --parent-page-id <pageId> <文件路径>
```

> **注意**：有 pageId 的文档会自动更新，无需 `--update` 参数。

**自然语言示例**：
- 「我修改了本地的文档，帮我同步回 KB」
- 「上传 docs/运维手册/运维手册.md」
- 「把这个文件推送到 KB」

---

### 场景三：上传新文档（Push + 创建）

**识别条件**：
- 本地 Markdown 文件 frontmatter 中**没有 `pageId`**（或没有 frontmatter）
- 用户想在 KB 上创建一个新页面

**参数提取**：
- `--parent-page-id`：**必须从用户提供的信息中获取**。可能来自：
  - 用户给出的 KB 页面链接（从 URL 中提取 pageId）
  - 用户明确说的父页面 ID
  - 如果用户没有提供，**必须向用户询问**目标父页面
- 文件路径：用户指定的 .md 文件
- 页面标题：自动取文件中第一个 `# 标题`

**命令模板**：
```bash
node cli.js push --parent-page-id <父页面ID> <文件路径>
```

> **注意**：如果父页面下已有同名子页面，不会覆盖（会跳过）。如需覆盖，加 `--update`。

**自然语言示例**：
- 「把 /path/to/guide.md 上传到 https://kb.cvte.com/pages/viewpage.action?pageId=123456 下面」
- 「在 KB 的运维手册页面下创建一个新文档」
- 「帮我把这个 Markdown 发到知识库」→ 需追问：「请提供目标父页面的链接或 ID」

## 参数推导指南

### 如何获取 parent-page-id

1. **用户给了 KB 链接**：从 URL 的 `pageId` 参数提取
   - `https://kb.cvte.com/pages/viewpage.action?pageId=495131888` → `495131888`
2. **用户说"上传到 XX 页面下"**：需要先确认具体链接或 ID
3. **从已有文档的 frontmatter 提取**：读取 .md 文件的 `pageId` 字段
4. **用户没提供**：**必须询问**，不要猜测

### 如何判断是更新还是创建

```
读取 .md 文件的 frontmatter
  ├─ 有 pageId → 更新已有页面（场景二）
  └─ 无 pageId → 创建新页面（场景三）
```

## 前置条件

- Node.js >= 16
- 首次运行会自动安装 Playwright 和 Chromium 浏览器（约 150MB）
- 认证方式（二选一）：
  - **Cookie 模式**：首次运行时通过浏览器登录（后续自动复用缓存）
  - **Token 模式**：设置 `KB_TOKEN` 环境变量（Bearer token）

## 命令参考

### Pull

```bash
node cli.js pull "<url>"
```

### Push

```bash
node cli.js push --parent-page-id <id> [--update] <file1.md> [file2.md ...]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--parent-page-id` | ✅ | 父页面 ID |
| `--update` | ❌ | 同名页面已存在时强制更新（无 pageId 的新文档才需要） |
| `--base-url` | ❌ | KB 地址，默认 `https://kb.cvte.com` |

## 提取后的文档格式

```markdown
---
pageId: "123456"
spaceKey: "ITKB"
sourceUrl: "https://kb.cvte.com/pages/viewpage.action?pageId=123456"
title: "页面标题"
author: "作者名"
lastModified: "2022-05-21 11:08:19"
version: 42
extractedAt: "2026-03-12 13:50:00"
---

# 页面标题

正文内容...
```

> **关键**：有 `pageId` 的文档 push 时自动更新对应页面；没有 `pageId` 的文档 push 时创建新页面。
