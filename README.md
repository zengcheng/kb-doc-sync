# KB 知识库双向同步工具

从 KB（Confluence）下载文档为 Markdown，或将本地 Markdown 上传到 KB。支持任意 Confluence 实例。

## 功能特性

- **Pull（下载）**：递归提取页面及子页面为 Markdown，自动下载图片和附件
- **Push（上传）**：Markdown 转 Confluence 格式，支持更新已有页面或创建新页面
- **智能判断**：有 frontmatter pageId → 自动更新；无 pageId → 创建新页面
- **代码块**：自动转为 Confluence code 宏
- **Mermaid**：流程图自动渲染为 PNG 上传
- **目录**：自动转为 Confluence TOC 宏
- **认证**：Cookie 缓存自动复用 / Token 模式免登录

## 快速使用（npx，无需本地安装）

确保已安装 Node.js (>=16)：

```bash
# 下载 KB 文档
npx git@github.com:zengcheng/kb-doc-sync.git pull "https://wiki.example.com/pages/viewpage.action?pageId=123456"

# 上传（更新已有页面，文件含 pageId frontmatter）
npx git@github.com:zengcheng/kb-doc-sync.git push /path/to/doc.md

# 上传（创建新页面）
npx git@github.com:zengcheng/kb-doc-sync.git push --base-url "https://wiki.example.com" --parent-page-id 123456 /path/to/new-doc.md
```

> ⚠️ 首次运行会自动安装 Playwright 和 Chromium（约 150MB），用于登录获取 cookie。

## 本地安装使用

```bash
git clone git@github.com:zengcheng/kb-doc-sync.git
cd kb-doc-sync
npm install
```

安装后可用 `node cli.js` 代替 `npx ...`：

```bash
node cli.js pull "https://wiki.example.com/pages/viewpage.action?pageId=123456"
node cli.js push docs/my-doc.md
```

> `push` 会优先从 Markdown frontmatter 里的 `sourceUrl` 自动推断站点地址；如果是本地新建文档，请显式传 `--base-url`。

## 使用场景

### 场景一：下载 KB 文档到本地

```bash
npx git@github.com:zengcheng/kb-doc-sync.git pull "https://wiki.example.com/pages/viewpage.action?pageId=123456"
```

下载后的文件结构：

```
docs/
  页面标题/
    页面标题.md           # 页面内容（含 frontmatter）
    INDEX.md              # 目录索引
    images/{pageId}/      # 图片
    attachments/{pageId}/ # 附件
    子页面标题/
      子页面标题.md
```

下载的 Markdown 文件头部包含 frontmatter 元数据：

```markdown
---
pageId: "123456"
spaceKey: "ITKB"
sourceUrl: "https://wiki.example.com/pages/viewpage.action?pageId=123456"
title: "页面标题"
author: "作者名"
lastModified: "2022-05-21 11:08:19"
version: 42
---

# 页面标题

正文内容...
```

---

### 场景二：上传已有文档回 KB（更新）

文件 frontmatter 中**有 pageId** → 自动更新对应页面，**无需 `--parent-page-id`**。

```bash
# 直接传文件即可
npx git@github.com:zengcheng/kb-doc-sync.git push /path/to/docs/页面标题.md

# 批量上传
npx git@github.com:zengcheng/kb-doc-sync.git push /path/to/a.md /path/to/b.md
```

---

### 场景三：上传本地新建文档到 KB（创建新页面）

文件**无 frontmatter** 或无 pageId → 需要通过 `--parent-page-id` 指定父页面。页面标题取自文件中第一个 `# 标题`。

```bash
npx git@github.com:zengcheng/kb-doc-sync.git push --base-url "https://wiki.example.com" --parent-page-id 123456 /path/to/new-doc.md
```

> 💡 如果父页面下已有同名页面，会**跳过**。加 `--update` 可强制覆盖。

## AI Agent 自然语言使用

本工具已发布为 AI Agent Skill，支持通过自然语言直接操作：

> 「帮我下载这篇 KB 文档 https://wiki.example.com/pages/viewpage.action?pageId=123456」

> 「我修改了本地的文档，帮我同步回 KB」

> 「把 /path/to/guide.md 上传到 https://wiki.example.com/pages/viewpage.action?pageId=123456 下面」

## 命令参考

| 操作 | 命令 |
|------|------|
| 下载 | `npx ...kb-doc-sync.git pull "<KB链接>"` |
| 更新已有页面 | `npx ...kb-doc-sync.git push <file>` |
| 创建新页面 | `npx ...kb-doc-sync.git push --parent-page-id <父页面ID> <file>` |
| 强制覆盖同名 | `npx ...kb-doc-sync.git push --parent-page-id <父页面ID> --update <file>` |

### Push 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--parent-page-id <id>` | 无 pageId 时必填 | 父页面 ID |
| `--update` | ❌ | 同名页面已存在时强制更新 |
| `--base-url <url>` | 新建页面时必填 | KB 地址，例如 `https://wiki.example.com` |

## 认证方式

1. **Cookie 模式**（默认）：首次运行自动打开浏览器登录，cookie 缓存复用
2. **Token 模式**：设置 `KB_TOKEN` 环境变量，无需浏览器

```bash
export KB_TOKEN="your-bearer-token"
```
