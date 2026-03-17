const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { htmlToMarkdown } = require("../src/converter/html-to-md");
const uploadModule = require("../src/upload");
const api = require("../src/api");
const converter = require("../src/converter/md-to-storage");

async function testHtmlCodeMacroPreserved() {
  const html = '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[const x = 1;\nconsole.log(x);]]></ac:plain-text-body></ac:structured-macro>';
  const md = htmlToMarkdown(html);
  assert(md.includes("const x = 1;"), "code macro content should be preserved");
  assert(md.includes("```"), "code macro should be converted to fenced code block");
}

function testWriteBackFrontmatterPreservesMetadata() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-"));
  const filePath = path.join(tmpDir, "doc.md");
  fs.writeFileSync(
    filePath,
    [
      "---",
      'pageId: "1"',
      'spaceKey: "OLD"',
      'title: "示例文档"',
      'sourceUrl: "https://kb.example.com/page"',
      "---",
      "# 标题",
      "",
      "正文",
    ].join("\n"),
    "utf8"
  );

  uploadModule.__private.writeBackFrontmatter(filePath, "2", "NEW");
  const content = fs.readFileSync(filePath, "utf8");

  assert(content.includes('pageId: "2"'));
  assert(content.includes('spaceKey: "NEW"'));
  assert(content.includes('title: "示例文档"'));
  assert(content.includes('sourceUrl: "/pages/viewpage.action?pageId=2"'));
}

async function testFindChildPagePaginates() {
  const originalApiGet = api.apiGet;
  try {
    api.apiGet = async (apiPath) => {
      if (apiPath.includes("start=0")) {
        return {
          results: Array.from({ length: 100 }, (_, index) => ({
            id: String(index + 1),
            title: `Page ${index + 1}`,
            version: { number: 1 },
          })),
        };
      }

      return {
        results: [
          { id: "101", title: "Target", version: { number: 7 } },
        ],
      };
    };

    const page = await uploadModule.__private.findChildPage("parent", "Target");
    assert(page, "expected to find page on second result page");
    assert.strictEqual(page.id, "101");
  } finally {
    api.apiGet = originalApiGet;
  }
}

async function testUpdateFlagUpdatesExistingChild() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-"));
  const filePath = path.join(tmpDir, "demo.md");
  fs.writeFileSync(filePath, "# 同名页面\n\n内容", "utf8");

  const originalApiGet = api.apiGet;
  const originalApiPut = api.apiPut;
  const originalApiPost = api.apiPost;
  const originalUploadAttachment = api.uploadAttachment;
  const originalMarkdownToConfluence = converter.markdownToConfluence;

  const calls = [];

  try {
    api.apiGet = async (apiPath) => {
      if (apiPath.includes("/child/page")) {
        return {
          results: [
            { id: "88", title: "同名页面", version: { number: 3 } },
          ],
        };
      }
      if (apiPath.includes("/child/attachment")) {
        return { results: [] };
      }
      if (apiPath.includes("/rest/api/content/parent")) {
        return { title: "父页面", space: { key: "DOC" } };
      }
      if (apiPath.includes("/rest/api/content/88")) {
        return { title: "同名页面", space: { key: "DOC" }, version: { number: 3 } };
      }
      throw new Error(`Unexpected apiGet: ${apiPath}`);
    };
    api.apiPut = async (apiPath, body) => {
      calls.push({ type: "put", apiPath, body });
      return { id: "88" };
    };
    api.apiPost = async (apiPath, body) => {
      calls.push({ type: "post", apiPath, body });
      return { id: "99" };
    };
    api.uploadAttachment = async () => ({});
    converter.markdownToConfluence = async () => ({ html: "<p>内容</p>", mermaidImages: [] });

    const result = await uploadModule.uploadFile(filePath, "parent", { update: true });
    assert.strictEqual(result.id, "88");
    assert.strictEqual(calls.filter((item) => item.type === "put").length, 1);
    assert.strictEqual(calls.filter((item) => item.type === "post").length, 0);
  } finally {
    api.apiGet = originalApiGet;
    api.apiPut = originalApiPut;
    api.apiPost = originalApiPost;
    api.uploadAttachment = originalUploadAttachment;
    converter.markdownToConfluence = originalMarkdownToConfluence;
  }
}

async function testNon404UpdateFailureDoesNotCreateDuplicate() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-"));
  const filePath = path.join(tmpDir, "demo.md");
  fs.writeFileSync(
    filePath,
    ['---', 'pageId: "123"', 'spaceKey: "DOC"', '---', '# 标题', '', '内容'].join("\n"),
    "utf8"
  );

  const originalApiGet = api.apiGet;
  const originalApiPut = api.apiPut;
  const originalApiPost = api.apiPost;
  const originalMarkdownToConfluence = converter.markdownToConfluence;

  let created = false;

  try {
    api.apiGet = async (apiPath) => {
      if (apiPath.includes("/rest/api/content/parent")) {
        return { title: "父页面", space: { key: "DOC" } };
      }
      if (apiPath.includes("/rest/api/content/123")) {
        return { title: "标题", space: { key: "DOC" }, version: { number: 5 } };
      }
      if (apiPath.includes("/child/attachment")) {
        return { results: [] };
      }
      throw new Error(`Unexpected apiGet: ${apiPath}`);
    };
    api.apiPut = async () => {
      throw new Error("HTTP 500: server error");
    };
    api.apiPost = async () => {
      created = true;
      return { id: "999" };
    };
    converter.markdownToConfluence = async () => ({ html: "<p>内容</p>", mermaidImages: [] });

    await assert.rejects(
      () => uploadModule.uploadFile(filePath, "parent", { update: true }),
      /无法更新 pageId=123: HTTP 500/
    );
    assert.strictEqual(created, false, "should not create duplicate page on non-404 update failure");
  } finally {
    api.apiGet = originalApiGet;
    api.apiPut = originalApiPut;
    api.apiPost = originalApiPost;
    converter.markdownToConfluence = originalMarkdownToConfluence;
  }
}

async function run() {
  const tests = [
    testHtmlCodeMacroPreserved,
    testWriteBackFrontmatterPreservesMetadata,
    testFindChildPagePaginates,
    testUpdateFlagUpdatesExistingChild,
    testNon404UpdateFailureDoesNotCreateDuplicate,
  ];

  for (const test of tests) {
    await test();
    console.log(`PASS ${test.name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
