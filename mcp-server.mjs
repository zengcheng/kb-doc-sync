#!/usr/bin/env node
/**
 * KB（Confluence）知识库双向同步工具 —— MCP Server 入口
 *
 * 通过 MCP 协议（stdio 传输）暴露 kb_pull 和 kb_push 两个 Tool，
 * 使 AI Agent 可以原生调用 KB 知识库同步能力。
 *
 * 运行方式：
 *   KB_TOKEN="your-token" node mcp-server.mjs
 *
 * 或配置到 Claude Desktop / IDE 的 MCP 设置中。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";

// 桥接 CJS 模块
const require = createRequire(import.meta.url);
const { setBaseUrl, initTokenAuth, initCookieAuth, isAuthenticated } = require("./src/auth.js");
const { testCookieValid } = require("./src/api.js");
const { extractPage, parseConfluenceUrl, resolvePageId } = require("./src/extract.js");
const { uploadFile } = require("./src/upload.js");

// ── 日志重定向 ────────────────────────────────────────
// MCP 使用 stdio 通信，所有日志必须走 stderr，否则会污染协议
const originalLog = console.log;
console.log = (...args) => console.error(...args);

// ── 认证初始化 ────────────────────────────────────────
// 优先级：KB_TOKEN 环境变量 > .cookies.json 文件 > 未认证
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KB_TOKEN = process.env.KB_TOKEN;
const BASE_URL = process.env.KB_BASE_URL || "https://kb.cvte.com";

if (KB_TOKEN) {
  // 方式一：Token 认证（优先）
  setBaseUrl(BASE_URL);
  initTokenAuth(KB_TOKEN);
  console.error(`✅ 已初始化 Token 认证，目标: ${BASE_URL}`);
} else {
  // 方式二：尝试从 .cookies.json 加载 Cookie
  // 查找顺序：MCP Server 所在目录 → 当前工作目录
  const cookiePaths = [
    join(__dirname, ".cookies.json"),
    join(process.cwd(), ".cookies.json"),
  ];

  let cookieLoaded = false;
  for (const cookiePath of cookiePaths) {
    if (!existsSync(cookiePath)) continue;
    try {
      const saved = JSON.parse(readFileSync(cookiePath, "utf-8"));
      if (saved.cookieString && saved.baseUrl) {
        setBaseUrl(saved.baseUrl);
        initCookieAuth(saved.cookieString);
        cookieLoaded = true;
        console.error(`✅ 已从 ${cookiePath} 加载 Cookie 认证，目标: ${saved.baseUrl}`);
        break;
      }
    } catch (e) {
      console.error(`⚠️ 读取 ${cookiePath} 失败: ${e.message}`);
    }
  }

  if (!cookieLoaded) {
    console.error(
      "⚠️ 未找到认证凭据。请设置 KB_TOKEN 环境变量，或先运行 CLI 登录一次生成 .cookies.json：\n" +
      "   npx git@github.com:zengcheng/kb-doc-sync.git pull \"<任意KB链接>\""
    );
  }
}

// ── 创建 MCP Server ──────────────────────────────────
const server = new McpServer({
  name: "kb-doc-sync",
  version: "2.1.0",
});

// ── 辅助函数 ─────────────────────────────────────────

/**
 * 检查认证状态，未认证时返回错误提示
 */
function requireAuth() {
  if (!isAuthenticated()) {
    return {
      content: [
        {
          type: "text",
          text: "❌ 未设置认证。请通过环境变量 KB_TOKEN 设置 Bearer Token。\n\n示例：\n  KB_TOKEN=\"your-token\" node mcp-server.mjs\n\n或在 MCP 配置中设置 env.KB_TOKEN。",
        },
      ],
      isError: true,
    };
  }
  return null;
}

/**
 * 捕获 console 输出用于返回给 Agent
 */
function captureOutput(fn) {
  const logs = [];
  const capture = (...args) => {
    const msg = args.map(String).join(" ");
    logs.push(msg);
    // 同时输出到 stderr 方便调试
    console.error(msg);
  };
  // 临时替换 console.log（已被重定向到 stderr）和 console.warn
  const prevLog = console.log;
  const prevWarn = console.warn;
  console.log = capture;
  console.warn = capture;
  return {
    logs,
    restore: () => {
      console.log = prevLog;
      console.warn = prevWarn;
    },
  };
}

// ── Tool: kb_pull ────────────────────────────────────
server.tool(
  "kb_pull",
  "从 KB（Confluence）下载页面为 Markdown 文档，支持递归下载子页面、图片和附件。",
  {
    url: z.string().describe("KB 页面链接，例如 https://kb.cvte.com/pages/viewpage.action?pageId=123456"),
  },
  async ({ url }) => {
    // 认证检查
    const authErr = requireAuth();
    if (authErr) return authErr;

    try {
      // 解析 URL
      const parsed = parseConfluenceUrl(url);
      if (!parsed) {
        return {
          content: [
            {
              type: "text",
              text: `❌ 无法解析链接: ${url}\n\n支持的格式：\n- https://kb.cvte.com/pages/viewpage.action?pageId=123456\n- https://kb.cvte.com/display/SPACE/Page+Title`,
            },
          ],
          isError: true,
        };
      }

      // 设置 baseUrl
      if (parsed.baseUrl) {
        setBaseUrl(parsed.baseUrl);
      }

      // 解析 pageId
      let pageId = parsed.pageId;
      if (!pageId && parsed.spaceKey && parsed.title) {
        pageId = await resolvePageId(parsed.spaceKey, parsed.title);
        if (!pageId) {
          return {
            content: [
              {
                type: "text",
                text: `❌ 未找到页面: space=${parsed.spaceKey}, title=${parsed.title}`,
              },
            ],
            isError: true,
          };
        }
      }

      // 执行下载
      const { logs, restore } = captureOutput();
      try {
        await extractPage(pageId, true);
      } finally {
        restore();
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ 下载完成\n\n${logs.join("\n")}`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 下载失败: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool: kb_push ────────────────────────────────────
server.tool(
  "kb_push",
  "将本地 Markdown 文件上传到 KB（Confluence）。文件 frontmatter 中有 pageId 时自动更新该页面，无 pageId 时在父页面下创建新页面。",
  {
    files: z
      .array(z.string())
      .min(1)
      .describe("要上传的 Markdown 文件绝对路径列表"),
    parentPageId: z
      .string()
      .optional()
      .describe("父页面 ID（仅在创建新页面时需要，文件有 pageId frontmatter 时可省略）"),
    update: z
      .boolean()
      .optional()
      .default(false)
      .describe("父页面下已存在同名页面时是否强制覆盖"),
    baseUrl: z
      .string()
      .optional()
      .describe("KB 地址，默认 https://kb.cvte.com"),
  },
  async ({ files, parentPageId, update, baseUrl }) => {
    // 认证检查
    const authErr = requireAuth();
    if (authErr) return authErr;

    try {
      // 设置 baseUrl
      if (baseUrl) {
        setBaseUrl(baseUrl);
      }

      const results = [];
      const allLogs = [];

      for (const filePath of files) {
        const { logs, restore } = captureOutput();
        try {
          const result = await uploadFile(filePath, parentPageId || null, { update });
          results.push({
            file: filePath,
            status: "ok",
            pageId: result.id,
            title: result.title,
          });
        } catch (e) {
          results.push({
            file: filePath,
            status: "error",
            error: e.message,
          });
        } finally {
          restore();
          allLogs.push(...logs);
        }
      }

      const okCount = results.filter((r) => r.status === "ok").length;
      const summary = `上传完成: ${okCount}/${results.length} 成功`;

      const details = results
        .map((r) => {
          if (r.status === "ok") {
            return `✅ ${r.file} → pageId=${r.pageId} [${r.title}]`;
          } else {
            return `❌ ${r.file} → ${r.error}`;
          }
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\n${details}\n\n--- 详细日志 ---\n${allLogs.join("\n")}`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `❌ 上传失败: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── 启动 ─────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("🚀 kb-doc-sync MCP Server 已启动 (stdio 模式)");
