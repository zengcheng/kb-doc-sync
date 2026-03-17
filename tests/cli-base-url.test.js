const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

function loadCliModule() {
  const cliPath = path.resolve(__dirname, "../cli.js");
  const code = fs.readFileSync(cliPath, "utf8");
  const instrumented = `${code}\nmodule.exports = { inferBaseUrlFromFiles };`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (id) => {
      if (id.startsWith("./")) {
        return require(path.resolve(path.dirname(cliPath), id));
      }
      return require(id);
    },
    __dirname: path.dirname(cliPath),
    __filename: cliPath,
    process: { ...process, argv: ["node", cliPath, "--help"] },
    console,
    URL,
  };

  vm.runInNewContext(instrumented, sandbox, { filename: cliPath });
  return sandbox.module.exports;
}

function writeMarkdown(dir, name, frontmatterLines) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(
    filePath,
    ["---", ...frontmatterLines, "---", "# 标题", "", "正文"].join("\n"),
    "utf8"
  );
  return filePath;
}

function testInferBaseUrlFromSourceUrl() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-cli-"));
  const filePath = writeMarkdown(tmpDir, "doc.md", [
    'pageId: "123"',
    'sourceUrl: "https://wiki.example.com/pages/viewpage.action?pageId=123"',
  ]);

  const { inferBaseUrlFromFiles } = loadCliModule();
  assert.strictEqual(
    inferBaseUrlFromFiles([filePath]),
    "https://wiki.example.com"
  );
}

function testInferBaseUrlReturnsNullWithoutSourceUrl() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-cli-"));
  const filePath = writeMarkdown(tmpDir, "doc.md", ['pageId: "123"']);

  const { inferBaseUrlFromFiles } = loadCliModule();
  assert.strictEqual(inferBaseUrlFromFiles([filePath]), null);
}

function testInferBaseUrlRejectsMixedSites() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-doc-sync-cli-"));
  const fileA = writeMarkdown(tmpDir, "a.md", [
    'sourceUrl: "https://wiki-a.example.com/pages/viewpage.action?pageId=1"',
  ]);
  const fileB = writeMarkdown(tmpDir, "b.md", [
    'sourceUrl: "https://wiki-b.example.com/pages/viewpage.action?pageId=2"',
  ]);

  const { inferBaseUrlFromFiles } = loadCliModule();
  assert.throws(
    () => inferBaseUrlFromFiles([fileA, fileB]),
    /多个不同的 KB 站点/
  );
}

function run() {
  testInferBaseUrlFromSourceUrl();
  console.log("PASS testInferBaseUrlFromSourceUrl");
  testInferBaseUrlReturnsNullWithoutSourceUrl();
  console.log("PASS testInferBaseUrlReturnsNullWithoutSourceUrl");
  testInferBaseUrlRejectsMixedSites();
  console.log("PASS testInferBaseUrlRejectsMixedSites");
}

run();
