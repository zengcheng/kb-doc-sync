/**
 * 上传模块 —— 将本地 Markdown 文档上传到 Confluence
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { apiGet, apiPost, apiPut, uploadAttachment } = require("./api");
const { getBaseUrl } = require("./auth");
const { markdownToConfluence } = require("./converter/md-to-storage");
const { formatDateTime, parseFrontmatter } = require("./utils");



/**
 * 从 Markdown 内容中提取页面标题
 * 优先使用第一个 # 标题，否则用文件名
 */
function extractTitle(mdBody, filePath) {
  for (const line of mdBody.split("\n")) {
    if (line.startsWith("# ")) {
      return line.substring(2).trim();
    }
  }
  return path.basename(filePath, ".md");
}

/**
 * 从 Markdown body 中移除用作页面标题的 # 标题行
 * 避免 Confluence 页面标题与正文 h1 重复
 */
function stripTitleFromBody(mdBody, title) {
  const lines = mdBody.split("\n");
  const idx = lines.findIndex(l => l.startsWith("# ") && l.substring(2).trim() === title);
  if (idx !== -1) {
    lines.splice(idx, 1);
    // 同时移除标题后紧跟的空行
    while (lines[idx] !== undefined && lines[idx].trim() === "") {
      lines.splice(idx, 1);
    }
  }
  return lines.join("\n");
}

/**
 * 获取页面信息
 */
async function getPageInfo(pageId) {
  return apiGet(`/rest/api/content/${pageId}?expand=space,version`);
}

/**
 * 查找同名子页面
 */
async function findChildPage(parentId, title) {
  const data = await apiGet(
    `/rest/api/content/${parentId}/child/page?limit=100&expand=version`
  );
  for (const page of (data.results || [])) {
    if (page.title === title) {
      return page;
    }
  }
  return null;
}

/**
 * 创建子页面
 */
async function createPage(spaceKey, parentId, title, contentHtml) {
  return apiPost("/rest/api/content", {
    type: "page",
    title,
    space: { key: spaceKey },
    ancestors: [{ id: parentId }],
    body: {
      storage: {
        value: contentHtml,
        representation: "storage",
      },
    },
  });
}

/**
 * 更新已有页面
 */
async function updatePage(pageId, title, contentHtml, version) {
  return apiPut(`/rest/api/content/${pageId}`, {
    type: "page",
    title,
    version: { number: version + 1 },
    body: {
      storage: {
        value: contentHtml,
        representation: "storage",
      },
    },
  });
}

/**
 * 上传一个 Markdown 文件到 Confluence
 * @param {string} filePath - Markdown 文件路径
 * @param {string} parentPageId - 父页面 ID
 * @param {object} options - 选项
 * @param {boolean} options.update - 是否更新已存在的同名页面
 * @returns {object} 上传结果
 */
async function uploadFile(filePath, parentPageId, options = {}) {
  const { update = false } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const { metadata, body } = parseFrontmatter(content);

  // 确定标题
  const title = extractTitle(body, filePath);

  // 确定目标 pageId（从 frontmatter 中读取）
  let targetPageId = metadata.pageId || null;
  const targetSpaceKey = metadata.spaceKey || null;

  // 冲突检测：frontmatter pageId 与 --parent-page-id 相同时，
  // 说明用户想在该页面下创建子页面，忽略 frontmatter pageId，避免覆盖父页面
  if (targetPageId && parentPageId && String(targetPageId) === String(parentPageId)) {
    console.log(`⚠️  frontmatter 中的 pageId (${targetPageId}) 与 --parent-page-id 相同`);
    console.log(`   将忽略 frontmatter pageId，在父页面下创建子页面`);
    targetPageId = null;
  }

  // 没有 frontmatter pageId 时，必须提供 parentPageId
  if (!targetPageId && !parentPageId) {
    throw new Error("文件无 frontmatter pageId，必须通过 --parent-page-id 指定父页面");
  }

  // 获取父页面信息（用于 spaceKey 以及创建新页面时的定位）
  let spaceKey = targetSpaceKey;
  if (parentPageId) {
    const parentInfo = await getPageInfo(parentPageId);
    spaceKey = spaceKey || parentInfo.space.key;
    console.log(`📁 父页面: [${parentInfo.title}] (space=${spaceKey})`);
  } else if (targetPageId) {
    // 无 parentPageId 但有 targetPageId → 从目标页面获取 spaceKey
    const pageInfo = await getPageInfo(targetPageId);
    spaceKey = spaceKey || pageInfo.space.key;
    console.log(`📁 目标页面: [${pageInfo.title}] (space=${spaceKey})`);
  }
  // 转换 Markdown → Confluence Storage Format（先移除标题行，避免与 KB 页面标题重复）
  const bodyWithoutTitle = stripTitleFromBody(body, title);
  let { html: contentHtml, mermaidImages } = await markdownToConfluence(bodyWithoutTitle);

  // 收集本地图片引用并替换为 Confluence 附件标签
  const mdDir = path.dirname(path.resolve(filePath));
  const localImages = collectLocalImages(contentHtml, mdDir);

  if (localImages.length > 0) {
    console.log(`  🖼️  发现 ${localImages.length} 个本地图片引用`);
    for (const img of localImages) {
      const escapedSrc = img.src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const imgRegex = new RegExp(`<img[^>]*src="${escapedSrc}"[^>]*/?>`, "gi");
      const replacement = `<ac:image><ri:attachment ri:filename="${img.filename}" /></ac:image>`;
      contentHtml = contentHtml.replace(imgRegex, replacement);
    }
  }

  let pageId;

  if (targetPageId) {
    // 有 pageId → 识别为已有页面，直接更新
    try {
      const existingInfo = await getPageInfo(targetPageId);
      const version = existingInfo.version.number;
      const result = await updatePage(targetPageId, title, contentHtml, version);
      pageId = result.id;
      console.log(`✅ 已更新: [${title}] (id=${pageId}, v${version + 1})`);
    } catch (e) {
      console.log(`⚠️ 无法更新 pageId=${targetPageId}: ${e.message}`);
      console.log("  将尝试在父页面下创建新页面...");
      const result = await createPage(spaceKey, parentPageId, title, contentHtml);
      pageId = result.id;
      console.log(`✅ 已创建: [${title}] (id=${pageId})`);
    }
  } else {
    // 无 pageId → 识别为新页面
    // 先查重：检查父页面下是否已有同名子页面
    const existing = await findChildPage(parentPageId, title);

    if (existing) {
      // 同名页面已存在，但本文件无 pageId，无法确认是否为同一页面
      // 不覆盖，避免误更新其他页面
      console.log(`❌ 父页面下已存在同名页面: [${title}] (id=${existing.id})`);
      console.log(`   本文件无 pageId，无法确认是否为同一页面，已跳过`);
      console.log(`   如需更新该页面，请在 frontmatter 中添加 pageId: "${existing.id}"`);
      return existing;
    } else {
      // 无同名页面 → 创建新页面
      const result = await createPage(spaceKey, parentPageId, title, contentHtml);
      pageId = result.id;
      console.log(`✅ 已创建: [${title}] (id=${pageId})`);
    }
  }

  // 查询页面已有附件名，用于跳过重复上传
  const existingAttNames = await getExistingAttachmentNames(pageId);

  // 上传本地图片作为附件（文件名与 KB 原始名一致，自动去重）
  if (localImages.length > 0) {
    const validImages = localImages.filter((img) => fs.existsSync(img.absolutePath));
    if (validImages.length > 0) {
      let uploaded = 0, skipped = 0;
      for (const img of validImages) {
        if (existingAttNames.has(img.filename)) {
          skipped++;
          continue;
        }
        try {
          await uploadAttachment(pageId, img.absolutePath, img.filename);
          uploaded++;
          console.log(`    ✅ ${img.filename}`);
        } catch (e) {
          console.log(`    ⚠️ ${img.filename} 上传失败: ${e.message}`);
        }
      }
      if (uploaded > 0 || skipped > 0) {
        console.log(`  📎 图片附件: ${uploaded} 个新上传, ${skipped} 个已存在跳过`);
      }
    }
  }

  // 上传 Mermaid 附件
  if (mermaidImages.length > 0) {
    console.log(`  📎 上传 ${mermaidImages.length} 个流程图附件...`);
    for (const { filename, data } of mermaidImages) {
      const tmpPath = path.join(os.tmpdir(), `kb_upload_${filename}`);
      try {
        fs.writeFileSync(tmpPath, data);
        await uploadAttachment(pageId, tmpPath, filename);
        console.log(`    ✅ ${filename}`);
      } catch (e) {
        console.log(`    ⚠️ ${filename} 上传失败: ${e.message}`);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    }
  }

  const pageUrl = `${getBaseUrl()}/pages/viewpage.action?pageId=${pageId}`;
  console.log(`   🔗 ${pageUrl}`);

  // 回写 frontmatter 到本地文件（确保后续 push 能识别为"更新"）
  writeBackFrontmatter(filePath, pageId, spaceKey);

  return { id: pageId, title };
}

/**
 * 获取页面已有附件名列表
 */
async function getExistingAttachmentNames(pageId) {
  const names = new Set();
  try {
    const data = await apiGet(`/rest/api/content/${pageId}/child/attachment?limit=200`);
    for (const a of (data.results || [])) {
      names.add(a.title);
    }
  } catch (e) {
    // 查询失败不影响上传
  }
  return names;
}

/**
 * 收集 HTML 中引用的本地图片文件
 * @param {string} html - 已转换的 HTML
 * @param {string} mdDir - Markdown 文件所在目录（用于解析相对路径）
 * @returns {Array<{ src: string, filename: string, absolutePath: string }>}
 */
function collectLocalImages(html, mdDir) {
  const images = [];
  const seen = new Set();
  // 匹配 <img src="xxx" ... />
  const imgRegex = /<img[^>]*src="([^"]*)"[^>]*\/?>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    // 跳过远程 URL 和 data URI
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      continue;
    }
    if (seen.has(src)) continue;
    seen.add(src);

    const absolutePath = path.resolve(mdDir, src);
    const filename = path.basename(src);
    images.push({ src, filename, absolutePath });
  }
  return images;
}

/**
 * 回写 frontmatter 到本地 Markdown 文件
 * push 成功后调用，确保本地文件包含 pageId 和 spaceKey，
 * 这样后续再次 push 时能直接走"更新已有页面"逻辑
 */
function writeBackFrontmatter(filePath, pageId, spaceKey) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { metadata, body } = parseFrontmatter(content);

    // 更新关键字段
    metadata.pageId = String(pageId);
    metadata.spaceKey = spaceKey || metadata.spaceKey || "";
    metadata.lastModified = formatDateTime(new Date().toISOString());

    // 只保留有用的字段
    const lines = [
      "---",
      `pageId: "${metadata.pageId}"`,
      `spaceKey: "${metadata.spaceKey}"`,
      `lastModified: "${metadata.lastModified}"`,
      "---",
    ];

    const newContent = lines.join("\n") + "\n" + body;
    fs.writeFileSync(filePath, newContent, "utf-8");
    console.log(`📝 已回写 frontmatter 到本地文件 (pageId=${pageId})`);
  } catch (e) {
    console.log(`⚠️ 回写 frontmatter 失败: ${e.message}`);
  }
}

module.exports = {
  uploadFile,
};
