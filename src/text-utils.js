// 文本工具（纯函数，零 DOM）：isChinese 汉字占比 >0.3；textOf 剥标签+实体解码；
// stripUrlTokens/hasTranslatableText 剔除 URL 后须有字母类字符（LETTER_RE 不含假名）；
// isWhitespaceOnly 空白整串判定（与输出侧净化同口径）

// 显式 URL 判定（裸域名不剔，避免误伤普通句子）
const URL_TEXT_RE = /^(https?:\/\/|www\.)\S+$/i;

// 空白字符全集：\s（JS 已含 NBSP \u00A0、\u2000-\u200A、\u3000、BOM \uFEFF 等）
// + 零宽 \u200B-\u200D（不在 \s 内，显式补齐）——与输出侧净化 src/sanitize.js 的
// NON_WS_RE 同一口径，两处任一改动需同步；HTML 实体经文本内容取用后已解码，不做实体层特判。
const NON_WS_RE = /[^\s\u200B-\u200D]/;

// 有实质文字（拉丁扩展/希腊/西里尔/谚文）
const LETTER_RE = /[A-Za-z\u00C0-\u02AF\u0370-\u03FF\u0400-\u04FF\uAC00-\uD7AF]/;

// 汉字占比 > 30% 视为中文，跳过
function isChinese(text) {
  const s = String(text);
  const han = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return han > 0 && han / s.length > 0.3;
}

// 轻量剥标签 + 常见实体解码（净文本预览用）
function textOf(html) {
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// 整串只由空白构成（含零宽字符）：空串视为空白
function isWhitespaceOnly(text) {
  return !NON_WS_RE.test(String(text));
}

// 剔除 URL 记号（不合并内部空格）
function stripUrlTokens(text) {
  return String(text)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .trim();
}

// 剔除 URL 后仍留有字母/文字类字符才算"有可翻内容"
function hasTranslatableText(text) {
  const stripped = stripUrlTokens(String(text).replace(/\s+/g, " ").trim());
  return !!stripped && LETTER_RE.test(stripped);
}

export {
  isChinese,
  textOf,
  stripUrlTokens,
  hasTranslatableText,
  isWhitespaceOnly,
  URL_TEXT_RE,
  LETTER_RE,
};
