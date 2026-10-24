/* Shared by the background, toolbar, options, and isolated compose-script worlds. */
(() => {
  "use strict";
  const CHANNEL = "thunderbird-rich-text/v1";
  const DEFAULT_TOOLBAR_SETTINGS = Object.freeze({ showToolbar: true, hideNativeToolbar: true });
  function normalizeToolbarSettings(value) {
    return {
      showToolbar: typeof value?.showToolbar === "boolean" ? value.showToolbar : DEFAULT_TOOLBAR_SETTINGS.showToolbar,
      hideNativeToolbar: typeof value?.hideNativeToolbar === "boolean" ? value.hideNativeToolbar : DEFAULT_TOOLBAR_SETTINGS.hideNativeToolbar
    };
  }
  const FONTS = [
    ["sans-serif", "Default sans serif"], ["serif", "Default serif"],
    ["Arial", "Arial"], ["Georgia", "Georgia"], ["Times New Roman", "Times New Roman"],
    ["Verdana", "Verdana"], ["Trebuchet MS", "Trebuchet MS"], ["Courier New", "Courier New"],
    ["Liberation Sans", "Liberation Sans"], ["Liberation Serif", "Liberation Serif"],
    ["DejaVu Sans", "DejaVu Sans"], ["Noto Sans", "Noto Sans"], ["monospace", "Monospace"]
  ];
  const SIZES = [["1", "Tiny"], ["2", "Small"], ["3", "Normal"], ["4", "Medium"],
    ["5", "Large"], ["6", "Extra large"], ["7", "Huge"]];
  const BLOCKS = [["p", "Paragraph"], ["h1", "Heading 1"], ["h2", "Heading 2"],
    ["h3", "Heading 3"], ["blockquote", "Quotation"], ["pre", "Preformatted"]];
  const TOGGLES = ["bold", "italic", "underline", "strikeThrough", "superscript", "subscript",
    "justifyLeft", "justifyCenter", "justifyRight", "justifyFull", "insertUnorderedList", "insertOrderedList"];
  const SIMPLE = new Set([...TOGGLES, "indent", "outdent", "removeFormat", "unlink", "undo", "redo", "insertHorizontalRule"]);
  const COLORS = [
    ["#1f2937", "Ink"], ["#6b7280", "Slate"], ["#ffffff", "White"], ["#dc2626", "Red"],
    ["#ea580c", "Orange"], ["#ca8a04", "Gold"], ["#15803d", "Green"], ["#0f766e", "Teal"],
    ["#2563eb", "Blue"], ["#7c3aed", "Violet"], ["#db2777", "Pink"], ["#854d0e", "Brown"]
  ];
  const HIGHLIGHTS = [
    ["#fef08a", "Lemon"], ["#fed7aa", "Peach"], ["#fecaca", "Rose"], ["#fbcfe8", "Blush"],
    ["#e9d5ff", "Lavender"], ["#c7d2fe", "Periwinkle"], ["#bfdbfe", "Sky"], ["#a5f3fc", "Aqua"],
    ["#99f6e4", "Mint"], ["#bbf7d0", "Lime"], ["#e5e7eb", "Mist"], ["#ffffff", "White"]
  ];
  const EMOJI = [
    ["😀", "grinning smile happy"], ["😊", "smiling happy thanks"], ["😂", "laugh tears joy"], ["🙂", "smile friendly"],
    ["😉", "wink"], ["😍", "heart eyes love"], ["🤔", "thinking question"], ["😎", "cool sunglasses"],
    ["🙌", "celebrate raised hands"], ["👏", "clap applause well done"], ["👍", "thumbs up yes good"], ["👎", "thumbs down no"],
    ["👋", "wave hello goodbye"], ["🙏", "thank you please folded hands"], ["🤝", "handshake agreement"], ["💪", "strong muscle"],
    ["❤️", "red heart love"], ["💚", "green heart"], ["💙", "blue heart"], ["✨", "sparkles"],
    ["🎉", "party celebration congratulations"], ["🎊", "confetti celebration"], ["🎂", "birthday cake"], ["🎁", "gift present"],
    ["✅", "check done yes"], ["❌", "cross no cancel"], ["⚠️", "warning attention"], ["💡", "idea light bulb"],
    ["📌", "pin important"], ["📅", "calendar date meeting"], ["📝", "memo note writing"], ["📎", "paperclip attachment"],
    ["📧", "email mail envelope"], ["💬", "speech chat message"], ["🔗", "link"], ["🔍", "search magnifying glass"],
    ["🚀", "rocket launch"], ["⭐", "star favorite"], ["🔥", "fire great"], ["🎯", "target goal"],
    ["☕", "coffee tea break"], ["🌱", "seedling growth plant"], ["🌍", "earth world globe"], ["☀️", "sun sunny"],
    ["🏡", "home house"], ["💻", "computer laptop work"], ["⏰", "alarm clock time"], ["📣", "announcement megaphone"]
  ];

  function normalizeColor(value, transparent = false) {
    if (transparent && value === "transparent") return value;
    if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) {
      throw new Error("Use a six-digit hex color, such as #187866.");
    }
    return value.toLowerCase();
  }

  function normalizeUrl(value) {
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value.trim())) {
      throw new Error("Enter a valid URL without spaces.");
    }
    let url;
    try { url = new URL(value.trim()); } catch {
      throw new Error("Enter a full URL starting with https://, http://, mailto:, or tel:.");
    }
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ||
        (["mailto:", "tel:"].includes(url.protocol) && !url.pathname)) {
      throw new Error("Links must use https://, http://, mailto:, or tel:.");
    }
    return url.href;
  }

  function normalizeCommand(command, value) {
    if (SIMPLE.has(command)) return { command };
    if (command === "fontName" && FONTS.some(([font]) => value === font)) return { command, value };
    if (command === "fontSize" && SIZES.some(([size]) => String(value) === size)) return { command, value: String(value) };
    if (command === "formatBlock" && BLOCKS.some(([block]) => value === block)) return { command, value };
    if (["foreColor", "hiliteColor"].includes(command)) {
      return { command, value: normalizeColor(value, command !== "foreColor") };
    }
    if (command === "insertText" && typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value)) {
      return { command, value };
    }
    if (command === "link" && value && typeof value === "object") {
      if (value.text !== undefined && (typeof value.text !== "string" || value.text.length > 2000)) {
        throw new Error("Link text must be 2,000 characters or fewer.");
      }
      return { command, value: { url: normalizeUrl(value.url), text: value.text || "" } };
    }
    throw new Error("This formatting option is not supported.");
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function linkHtml(url, text) {
    const safeUrl = normalizeUrl(url);
    return `<a href="${escapeHtml(safeUrl)}">${escapeHtml(text || safeUrl)}</a>`;
  }

  function isPlainTextCommand(command) {
    return ["insertText", "undo", "redo"].includes(command);
  }

  globalThis.RichText = Object.freeze({ CHANNEL, FONTS, SIZES, BLOCKS, TOGGLES, COLORS, HIGHLIGHTS,
    EMOJI, normalizeColor, normalizeUrl, normalizeCommand, escapeHtml, linkHtml, isPlainTextCommand,
    DEFAULT_TOOLBAR_SETTINGS, normalizeToolbarSettings });
})();
