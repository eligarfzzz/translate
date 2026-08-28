// ============================================================
// 文本工具（纯函数：零 DOM）
//
// 双环境：扩展全局 TextUtils + node 模块导出（与 config.js 模式一致）。
// 语义来源：v3 content script 内联实现原样迁移，行为零变化。
//   • isChinese：汉字占比 > 0.3 视为中文
//   • textOf：剥标签 + 常见实体解码（流式预览用轻量剥标签）
//   • stripUrlTokens / hasTranslatableText：剔除 URL 后须有字母/文字类字符
//     （LETTER_RE 覆盖拉丁扩展/希腊/西里尔/谚文；与原实现一致，不含假名）
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TextUtils = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // <a> 文本为显式 URL 的判定（https?:// 或 www. 开头；裸域名不剔，避免误伤普通句子）
  const URL_TEXT_RE = /^(https?:\/\/|www\.)\S+$/i;

  // 有实质文字（拉丁扩展/希腊/西里尔/谚文等），与原 content.js 内联实现逐字符一致
  const LETTER_RE =
    /[A-Za-z\u00C0-\u02AF\u0370-\u03FF\u0400-\u04FF\uAC00-\uD7AF]/;

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

  return {
    isChinese,
    textOf,
    stripUrlTokens,
    hasTranslatableText,
    URL_TEXT_RE,
    LETTER_RE,
  };
});
