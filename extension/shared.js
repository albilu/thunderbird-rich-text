/* Shared by the background, toolbar, options, and isolated compose-script worlds. */
(() => {
  "use strict";
  function message(key, substitutions = []) {
    return globalThis.browser?.i18n?.getMessage(key, substitutions) || key;
  }
  function normalizeSearch(value) {
    return String(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/œ/gi, "oe").toLowerCase().trim();
  }
  function emojiMatches([value, key, aliases], search) {
    return normalizeSearch(`${value} ${message(key)} ${aliases}`).includes(normalizeSearch(search));
  }
  const CHANNEL = "thunderbird-rich-text/v1";
  const DEFAULT_TOOLBAR_SETTINGS = Object.freeze({ showToolbar: true, hideNativeToolbar: true });
  function normalizeToolbarSettings(value) {
    return {
      showToolbar: typeof value?.showToolbar === "boolean" ? value.showToolbar : DEFAULT_TOOLBAR_SETTINGS.showToolbar,
      hideNativeToolbar: typeof value?.hideNativeToolbar === "boolean" ? value.hideNativeToolbar : DEFAULT_TOOLBAR_SETTINGS.hideNativeToolbar
    };
  }
  const FONTS = ["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const TYPOGRAPHY_COMMANDS = ["fontSize", "lineSpacing", "paragraphSpacing"];
  function normalizeFontName(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 200 ||
        /[\u0000-\u001f\u007f;,{}<>\\]/u.test(value) || /url\s*\(/i.test(value)) {
      throw new Error(message("errorFontName"));
    }
    return value.trim();
  }
  function normalizeNumber(value, min, max, label) {
    const invalid = () => {
      const format = new Intl.NumberFormat(message("localeCode"));
      return new Error(message("errorNumberRange", [label, format.format(min), format.format(max)]));
    };
    if ((typeof value !== "number" && typeof value !== "string") ||
        !/^\d+(?:\.\d+)?$/.test(String(value).trim())) throw invalid();
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw invalid();
    return Math.round(number * 100) / 100;
  }
  const BLOCKS = [["p", "blockParagraph"], ["h1", "blockHeading1"], ["h2", "blockHeading2"],
    ["h3", "blockHeading3"], ["blockquote", "blockQuotation"], ["pre", "blockPreformatted"]];
  const TOGGLES = ["bold", "italic", "underline", "strikeThrough", "superscript", "subscript",
    "justifyLeft", "justifyCenter", "justifyRight", "justifyFull", "insertUnorderedList", "insertOrderedList"];
  const SIMPLE = new Set([...TOGGLES, "indent", "outdent", "removeFormat", "unlink", "undo", "redo", "insertHorizontalRule"]);
  const COLORS = [
    ["#1f2937", "colorInk"], ["#6b7280", "colorSlate"], ["#ffffff", "colorWhite"], ["#dc2626", "colorRed"],
    ["#ea580c", "colorOrange"], ["#ca8a04", "colorGold"], ["#15803d", "colorGreen"], ["#0f766e", "colorTeal"],
    ["#2563eb", "colorBlue"], ["#7c3aed", "colorViolet"], ["#db2777", "colorPink"], ["#854d0e", "colorBrown"]
  ];
  const HIGHLIGHTS = [
    ["#fef08a", "colorLemon"], ["#fed7aa", "colorPeach"], ["#fecaca", "colorRose"], ["#fbcfe8", "colorBlush"],
    ["#e9d5ff", "colorLavender"], ["#c7d2fe", "colorPeriwinkle"], ["#bfdbfe", "colorSky"], ["#a5f3fc", "colorAqua"],
    ["#99f6e4", "colorMint"], ["#bbf7d0", "colorLime"], ["#e5e7eb", "colorMist"], ["#ffffff", "colorWhite"]
  ];
  const EMOJI = [
    ["😀", "emojiGrinning", "grinning smile happy"], ["😊", "emojiSmiling", "smiling happy thanks"], ["😂", "emojiLaughing", "laugh tears joy"], ["🙂", "emojiFriendly", "smile friendly"],
    ["😉", "emojiWink", "wink"], ["😍", "emojiHeartEyes", "heart eyes love"], ["🤔", "emojiThinking", "thinking question"], ["😎", "emojiSunglasses", "cool sunglasses"],
    ["🙌", "emojiRaisedHands", "celebrate raised hands"], ["👏", "emojiClap", "clap applause well done"], ["👍", "emojiThumbsUp", "thumbs up yes good"], ["👎", "emojiThumbsDown", "thumbs down no"],
    ["👋", "emojiWave", "wave hello goodbye"], ["🙏", "emojiThanks", "thank you please folded hands"], ["🤝", "emojiHandshake", "handshake agreement"], ["💪", "emojiMuscle", "strong muscle"],
    ["❤️", "emojiRedHeart", "red heart love"], ["💚", "emojiGreenHeart", "green heart"], ["💙", "emojiBlueHeart", "blue heart"], ["✨", "emojiSparkles", "sparkles"],
    ["🎉", "emojiParty", "party celebration congratulations"], ["🎊", "emojiConfetti", "confetti celebration"], ["🎂", "emojiBirthday", "birthday cake"], ["🎁", "emojiGift", "gift present"],
    ["✅", "emojiCheck", "check done yes"], ["❌", "emojiCross", "cross no cancel"], ["⚠️", "emojiWarning", "warning attention"], ["💡", "emojiIdea", "idea light bulb"],
    ["📌", "emojiPin", "pin important"], ["📅", "emojiCalendar", "calendar date meeting"], ["📝", "emojiNote", "memo note writing"], ["📎", "emojiAttachment", "paperclip attachment"],
    ["📧", "emojiMail", "email mail envelope"], ["💬", "emojiChat", "speech chat message"], ["🔗", "emojiLink", "link"], ["🔍", "emojiSearch", "search magnifying glass"],
    ["🚀", "emojiRocket", "rocket launch"], ["⭐", "emojiStar", "star favorite"], ["🔥", "emojiFire", "fire great"], ["🎯", "emojiTarget", "target goal"],
    ["☕", "emojiCoffee", "coffee tea break"], ["🌱", "emojiSeedling", "seedling growth plant"], ["🌍", "emojiEarth", "earth world globe"], ["☀️", "emojiSun", "sun sunny"],
    ["🏡", "emojiHome", "home house"], ["💻", "emojiComputer", "computer laptop work"], ["⏰", "emojiClock", "alarm clock time"], ["📣", "emojiAnnouncement", "announcement megaphone"]
  ];

  function normalizeColor(value, transparent = false) {
    if (transparent && value === "transparent") return value;
    if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) {
      throw new Error(message("errorColor"));
    }
    return value.toLowerCase();
  }

  function normalizeUrl(value) {
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value.trim())) {
      throw new Error(message("errorUrlSpaces"));
    }
    let url;
    try { url = new URL(value.trim()); } catch {
      throw new Error(message("errorUrlFull"));
    }
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ||
        (["mailto:", "tel:"].includes(url.protocol) && !url.pathname)) {
      throw new Error(message("errorUrlScheme"));
    }
    return url.href;
  }

  function normalizeCommand(command, value) {
    if (SIMPLE.has(command)) return { command };
    if (["paragraphSpacingIncrease", "paragraphSpacingDecrease"].includes(command)) {
      return { command: "paragraphSpacing", value: { adjust: command === "paragraphSpacingIncrease" ? "increase" : "decrease" } };
    }
    if (command === "fontName") return { command, value: normalizeFontName(value) };
    if (command === "fontSize") return { command, value: normalizeNumber(value, 1, 200, message("fontSizePoints")) };
    if (command === "lineSpacing") return { command, value: value === "normal" ? value : normalizeNumber(value, 0.5, 5, message("lineSpacingValidation")) };
    if (command === "paragraphSpacing" && value && typeof value === "object") {
      if (Object.hasOwn(value, "adjust")) {
        if (Object.keys(value).length !== 1 || !["increase", "decrease"].includes(value.adjust)) throw new Error(message("errorParagraphDirection"));
        return { command, value: { adjust: value.adjust } };
      }
      const spacing = {};
      for (const key of ["before", "after"]) if (value[key] !== undefined) spacing[key] = normalizeNumber(value[key], 0, 200, message("paragraphSpacingPoints"));
      if (Object.keys(spacing).length) return { command, value: spacing };
    }
    if (command === "formatBlock" && BLOCKS.some(([block]) => value === block)) return { command, value };
    if (["foreColor", "hiliteColor"].includes(command)) {
      return { command, value: normalizeColor(value, command !== "foreColor") };
    }
    if (command === "insertText" && typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value)) {
      return { command, value };
    }
    if (command === "link" && value && typeof value === "object") {
      if (value.text !== undefined && (typeof value.text !== "string" || value.text.length > 2000)) {
        throw new Error(message("errorLinkText"));
      }
      return { command, value: { url: normalizeUrl(value.url), text: value.text || "" } };
    }
    throw new Error(message("errorUnsupportedFormat"));
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

  globalThis.RichText = Object.freeze({ message, normalizeSearch, emojiMatches, CHANNEL, FONTS, SIZES, BLOCKS, TOGGLES, COLORS, HIGHLIGHTS,
    EMOJI, normalizeColor, normalizeUrl, normalizeCommand, escapeHtml, linkHtml, isPlainTextCommand,
    DEFAULT_TOOLBAR_SETTINGS, normalizeToolbarSettings, TYPOGRAPHY_COMMANDS, normalizeFontName });
})();
