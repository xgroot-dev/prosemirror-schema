import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { liftTarget } from "prosemirror-transform";
import { MenuItem } from "prosemirror-menu";
import { undo, redo } from "prosemirror-history";
import { openPrompt } from "../prompt";
import { TextField } from "../TextField";
import {
  blockTypeIsActive,
  markItem,
  toggleBlockType,
} from "./common";
import icons from "../icons";
import { markActive } from "../utils";

// Resolve a translation key with English fallback. `t` follows vue-i18n's
// behaviour of returning the key when no translation is registered.
const tr = (t, key, fallback) => {
  if (!t) return fallback;
  const result = t(key);
  return result && result !== key ? result : fallback;
};

// Attach a richer tooltip via host app's helper (e.g. floating-vue), falling
// back to the native `title` attribute when no helper is provided. Always
// keep the title attribute too as accessibility fallback.
const setTooltip = (el, text, attachTooltip) => {
  if (!el || !text) return;
  if (typeof attachTooltip === "function") attachTooltip(el, text);
  else el.title = text;
};

// Returns info about the innermost list (bullet/ordered) that contains the
// selection, or null when the selection is not inside any list.
const parentListInfo = (state) => {
  const { $from } = state.selection;
  const { bullet_list, ordered_list } = state.schema.nodes;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === bullet_list || node.type === ordered_list) {
      return { type: node.type, pos: $from.before(depth) };
    }
  }
  return null;
};

// Depth of the nearest blockquote ancestor of the selection, or null when the
// selection is not inside one. Returns the innermost match, which is the one
// the unwrap command targets. (common.js's blockTypeIsActive would return the
// outermost, so `active` and `run` would disagree on nested quotes.)
const parentBlockquoteDepth = (state) => {
  const { $from } = state.selection;
  const { blockquote } = state.schema.nodes;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === blockquote) return depth;
  }
  return null;
};

// A single command that lets the toolbar button behave like an on/off toggle,
// mirroring the mark buttons:
//   - not in a list          -> wrap the selection in `listType`
//   - already in `listType`  -> lift the item out (turn the list off)
//   - in a different list     -> convert the innermost list to `listType`
// Indentation/nesting stays on Tab / Shift-Tab (see keymap.js), so the button
// no longer creates a new nesting level on every click.
const toggleList = (listType, itemType, attrs) => (state, dispatch, view) => {
  const info = parentListInfo(state);
  if (!info) {
    return wrapInList(listType, attrs)(state, dispatch, view);
  }
  if (info.type === listType) {
    return liftListItem(itemType)(state, dispatch);
  }
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup(info.pos, listType).scrollIntoView());
  }
  return true;
};

// Build a toolbar MenuItem for a list type. Uses `enable`/`active` (never
// `select`) so the button always stays visible: greyed out when it can't run
// and highlighted while the selection sits inside a list of this type.
const toggleListItem = (listType, options) => {
  const command = (state, dispatch, view) =>
    toggleList(listType, state.schema.nodes.list_item, options.attrs)(
      state,
      dispatch,
      view
    );
  return new MenuItem({
    ...options,
    label: options.title,
    run: command,
    enable: (state) => command(state),
    active: (state) => {
      const info = parentListInfo(state);
      return info != null && info.type === listType;
    },
  });
};

// A single on/off toggle, mirroring toggleList:
//   - not in a blockquote -> wrap the selection
//   - already in one      -> lift the blockquote's own children up one level,
//                            which removes the wrapper.
// The blockRange predicate pins the range's parent to the blockquote, so
// liftTarget lifts the blockquote's children — never an intervening list_item.
// Without it, a caret inside a list-inside-a-quote would outdent the list.
const toggleBlockquote = (blockquoteType) => (state, dispatch, view) => {
  if (parentBlockquoteDepth(state) == null) {
    return wrapIn(blockquoteType)(state, dispatch, view);
  }
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (node) => node.type === blockquoteType);
  const target = range && liftTarget(range);
  if (target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
};

// Uses `enable`/`active` (never `select`) so the button always stays visible:
// greyed out when neither wrap nor unwrap is possible, highlighted while the
// selection sits inside a blockquote. `enable` dry-runs the command with no
// dispatch, exactly like toggleListItem.
const blockquoteItem = (blockquoteType, options) => {
  const command = toggleBlockquote(blockquoteType);
  return new MenuItem({
    ...options,
    label: options.title,
    run: command,
    enable: (state) => command(state),
    active: (state) => parentBlockquoteDepth(state) != null,
  });
};

const imageUploadItem = (nodeType, onImageUpload, t) =>
  new MenuItem({
    title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.IMAGE_UPLOAD", "Upload image"),
    icon: icons.image,
    enable() {
      return true;
    },
    run() {
      onImageUpload();
      return true;
    },
  });

// In-toolbar button for inserting an html_embed block. Mirrors imageUploadItem:
// the host wires up `onHtmlEmbed` (move whatever the old above-editor button did
// here). The current EditorView is passed so the host can insert the node, e.g.
//   view.dispatch(view.state.tr.replaceSelectionWith(
//     schema.nodes.html_embed.create({ html })));
const htmlEmbedItem = (onHtmlEmbed, t) =>
  new MenuItem({
    title: tr(
      t,
      "CONVERSATION.REPLYBOX.EDITOR.HTML_EMBED",
      "Insert HTML embed"
    ),
    // Text icon: render the literal label "HTML" instead of a glyph, so it reads
    // unambiguously and doesn't collide with the </> inline-code button.
    icon: {
      text: "HTML",
      css: "font-weight: 700; font-size: 9px; letter-spacing: -0.3px;",
    },
    enable() {
      return true;
    },
    run(state, dispatch, view) {
      onHtmlEmbed(view);
      return true;
    },
  });

const headerItem = (nodeType, options) => {
  const { level = 1 } = options;
  return new MenuItem({
    title: options.title || `Heading ${level}`,
    icon: options.icon,
    active(state) {
      return blockTypeIsActive(state, nodeType, { level });
    },
    enable() {
      return true;
    },
    run(state, dispatch, view) {
      if (blockTypeIsActive(state, nodeType, { level })) {
        toggleBlockType(nodeType, { level })(state, dispatch);
        return true;
      }

      toggleBlockType(nodeType, { level })(view.state, view.dispatch);
      view.focus();

      return false;
    },
  });
};

const linkItem = (markType, t) =>
  new MenuItem({
    title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.LINK", "Add or remove link"),
    icon: icons.link,
    active(state) {
      return markActive(state, markType);
    },
    enable(state) {
      return !state.selection.empty;
    },
    run(state, dispatch, view) {
      if (markActive(state, markType)) {
        toggleMark(markType)(state, dispatch);
        return true;
      }
      openPrompt({
        title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.CREATE_LINK", "Create a link"),
        submitLabel: tr(
          t,
          "CONVERSATION.REPLYBOX.EDITOR.SAVE_LINK",
          "Create Link"
        ),
        cancelLabel: tr(
          t,
          "CONVERSATION.REPLYBOX.EDITOR.CANCEL",
          "Cancel"
        ),
        fields: {
          href: new TextField({
            label: tr(
              t,
              "CONVERSATION.REPLYBOX.EDITOR.LINK_PLACEHOLDER",
              "https://example.com"
            ),
            class: "small",
            required: true,
          }),
        },
        callback(attrs) {
          toggleMark(markType, attrs)(view.state, view.dispatch);
          view.focus();
        },
      });
      return false;
    },
  });

// Text color palette shared with dashboard's wootConstants.COLORS — kept in
// sync manually so this patch stays self-contained (the package can't import
// app constants). `key` doubles as the i18n suffix.
const TEXT_COLOR_PALETTE = [
  { key: "RED", name: "Red", value: "#FF0000" },
  { key: "YELLOW", name: "Yellow", value: "#FFBF05" },
  { key: "BLUE", name: "Blue", value: "#0000FF" },
  { key: "ROSE_RED", name: "Rose Red", value: "#C12161" },
  { key: "DEEP_CYAN", name: "Deep Cyan", value: "#007181" },
  { key: "ORANGE", name: "Orange", value: "#FF6A00" },
  { key: "PISTACHIO", name: "Pistachio", value: "#A9E694" },
  { key: "PURPLE", name: "Purple", value: "#6638D9" },
  { key: "FUCHSIA", name: "Fuchsia", value: "#FF00FF" },
  { key: "SILVER", name: "Silver", value: "#999999" },
  { key: "NAVY", name: "Navy", value: "#151882" },
  { key: "OLD_PINK", name: "Old Pink", value: "#CF809E" },
  { key: "AQUA", name: "Aqua", value: "#00D2D9" },
  { key: "BROWN", name: "Brown", value: "#664933" },
  { key: "OLIVE", name: "Olive", value: "#665E00" },
  { key: "GOLD", name: "Gold", value: "#D9B100" },
  { key: "BEIGE", name: "Beige", value: "#938576" },
  { key: "WINE", name: "Wine", value: "#791A3E" },
  { key: "FOREST", name: "Forest", value: "#004528" },
  { key: "GREEN", name: "Green", value: "#3f784f" },
  { key: "BLUE_GREY", name: "Blue Grey", value: "#8AA0E2" },
  { key: "RUBY_RED", name: "Ruby Red", value: "#CF1840" },
  { key: "CHESTNUT_BROWN", name: "Chestnut Brown", value: "#A44A2B" },
  { key: "ASH_GREY", name: "Ash Grey", value: "#6e776e" },
];

const showTextColorPicker = (
  view,
  markType,
  t,
  attachTooltip,
  detachTooltip,
  anchorEl
) => {
  document
    .querySelectorAll(".pm-color-picker-popup")
    .forEach((el) => el.remove());

  const popup = document.createElement("div");
  popup.className = "pm-color-picker-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.cssText = [
    "position: fixed",
    `top: ${rect.bottom + 4}px`,
    `left: ${rect.left}px`,
    "z-index: 9999",
    "background: rgb(var(--solid-1, 255 255 255))",
    "border: 1px solid rgba(0,0,0,0.12)",
    "border-radius: 12px",
    "padding: 4px",
    "box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.05)",
  ].join(";");

  const grid = document.createElement("div");
  grid.style.cssText = [
    "display: grid",
    "grid-template-columns: repeat(10, 22px)",
    "gap: 4px",
  ].join(";");

  // Tooltipped elements live in document.body via floating-vue's popper;
  // they don't auto-cleanup when their anchor is removed from the DOM, so
  // we track them and explicitly detach before popup.remove().
  const tooltipAnchors = [];
  const closePopup = () => {
    if (typeof detachTooltip === "function") {
      tooltipAnchors.forEach((el) => detachTooltip(el));
    }
    popup.remove();
  };

  const applyColor = (color) => {
    const { from, to, empty } = view.state.selection;
    let tr = view.state.tr;
    if (color === null) {
      tr = empty
        ? tr.removeStoredMark(markType)
        : tr.removeMark(from, to, markType);
    } else if (empty) {
      tr = tr.addStoredMark(markType.create({ color }));
    } else {
      tr = tr
        .removeMark(from, to, markType)
        .addMark(from, to, markType.create({ color }));
    }
    view.dispatch(tr);
    view.focus();
    closePopup();
  };

  TEXT_COLOR_PALETTE.forEach((color) => {
    const swatch = document.createElement("div");
    setTooltip(
      swatch,
      tr(t, `CONVERSATION.REPLYBOX.EDITOR.COLOR.${color.key}`, color.name),
      attachTooltip
    );
    tooltipAnchors.push(swatch);
    swatch.style.cssText = [
      "width: 22px",
      "height: 22px",
      "border-radius: 4px",
      "cursor: pointer",
      "border: 1px solid rgba(0,0,0,0.1)",
      `background: ${color.value}`,
      "transition: transform 0.1s",
    ].join(";");
    swatch.addEventListener("mouseenter", () => {
      swatch.style.transform = "scale(1.15)";
    });
    swatch.addEventListener("mouseleave", () => {
      swatch.style.transform = "";
    });
    swatch.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyColor(color.value);
    });
    grid.appendChild(swatch);
  });

  popup.appendChild(grid);

  const clear = document.createElement("div");
  setTooltip(
    clear,
    tr(t, "CONVERSATION.REPLYBOX.EDITOR.CLEAR_FORMATTING", "Clear formatting"),
    attachTooltip
  );
  tooltipAnchors.push(clear);
  clear.style.cssText = [
    "margin-top: 4px",
    "padding: 8px 12px",
    "border-radius: 8px",
    "color: #666",
    "cursor: pointer",
    "display: flex",
    "justify-content: center",
    "align-items: center",
  ].join(";");
  clear.addEventListener("mouseenter", () => {
    clear.style.backgroundColor = "rgba(0,0,0,0.04)";
  });
  clear.addEventListener("mouseleave", () => {
    clear.style.backgroundColor = "";
  });
  clear.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M3.27 5 2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5ZM6 5v.18L8.82 8h2.4l-.93 2.15 2.09 2.09L13.32 8H20V5H6Z"/>' +
    "</svg>";
  clear.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyColor(null);
  });
  popup.appendChild(clear);

  document.body.appendChild(popup);

  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target)) {
        closePopup();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
};

const textColorItem = (markType, t, attachTooltip, detachTooltip) =>
  new MenuItem({
    title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.TEXT_COLOR", "Text color"),
    icon: icons.textColor,
    enable() {
      return true;
    },
    run(state, dispatch, view, event) {
      showTextColorPicker(
        view,
        markType,
        t,
        attachTooltip,
        detachTooltip,
        event.currentTarget
      );
      return true;
    },
  });

// Background color palette mirrors TEXT_COLOR_PALETTE; the schema mark name is
// `backgroundColor` (see emailSchema.js) and stores the value under attr
// `backgroundColor`. HTML mode only — no markdown round-trip.
const BG_COLOR_PALETTE = [
  { key: "RED", name: "Red", value: "#FF0000" },
  { key: "YELLOW", name: "Yellow", value: "#FFBF05" },
  { key: "BLUE", name: "Blue", value: "#0000FF" },
  { key: "ROSE_RED", name: "Rose Red", value: "#C12161" },
  { key: "DEEP_CYAN", name: "Deep Cyan", value: "#007181" },
  { key: "ORANGE", name: "Orange", value: "#FF6A00" },
  { key: "PISTACHIO", name: "Pistachio", value: "#A9E694" },
  { key: "PURPLE", name: "Purple", value: "#6638D9" },
  { key: "FUCHSIA", name: "Fuchsia", value: "#FF00FF" },
  { key: "SILVER", name: "Silver", value: "#999999" },
  { key: "NAVY", name: "Navy", value: "#151882" },
  { key: "OLD_PINK", name: "Old Pink", value: "#CF809E" },
  { key: "AQUA", name: "Aqua", value: "#00D2D9" },
  { key: "BROWN", name: "Brown", value: "#664933" },
  { key: "OLIVE", name: "Olive", value: "#665E00" },
  { key: "GOLD", name: "Gold", value: "#D9B100" },
  { key: "BEIGE", name: "Beige", value: "#938576" },
  { key: "WINE", name: "Wine", value: "#791A3E" },
  { key: "FOREST", name: "Forest", value: "#004528" },
  { key: "GREEN", name: "Green", value: "#3f784f" },
  { key: "BLUE_GREY", name: "Blue Grey", value: "#8AA0E2" },
  { key: "RUBY_RED", name: "Ruby Red", value: "#CF1840" },
  { key: "CHESTNUT_BROWN", name: "Chestnut Brown", value: "#A44A2B" },
  { key: "ASH_GREY", name: "Ash Grey", value: "#6e776e" },
];

const showBgColorPicker = (
  view,
  markType,
  t,
  attachTooltip,
  detachTooltip,
  anchorEl
) => {
  document
    .querySelectorAll(".pm-bg-color-picker-popup")
    .forEach((el) => el.remove());

  const popup = document.createElement("div");
  popup.className = "pm-bg-color-picker-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.cssText = [
    "position: fixed",
    `top: ${rect.bottom + 4}px`,
    `left: ${rect.left}px`,
    "z-index: 9999",
    "background: rgb(var(--solid-1, 255 255 255))",
    "border: 1px solid rgba(0,0,0,0.12)",
    "border-radius: 12px",
    "padding: 4px",
    "box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.05)",
  ].join(";");

  const grid = document.createElement("div");
  grid.style.cssText = [
    "display: grid",
    "grid-template-columns: repeat(10, 22px)",
    "gap: 4px",
  ].join(";");

  const tooltipAnchors = [];
  const closePopup = () => {
    if (typeof detachTooltip === "function") {
      tooltipAnchors.forEach((el) => detachTooltip(el));
    }
    popup.remove();
  };

  const applyColor = (color) => {
    const { from, to, empty } = view.state.selection;
    let tr = view.state.tr;
    if (color === null) {
      tr = empty
        ? tr.removeStoredMark(markType)
        : tr.removeMark(from, to, markType);
    } else if (empty) {
      tr = tr.addStoredMark(markType.create({ backgroundColor: color }));
    } else {
      tr = tr
        .removeMark(from, to, markType)
        .addMark(from, to, markType.create({ backgroundColor: color }));
    }
    view.dispatch(tr);
    view.focus();
    closePopup();
  };

  BG_COLOR_PALETTE.forEach((color) => {
    const swatch = document.createElement("div");
    setTooltip(
      swatch,
      tr(t, `CONVERSATION.REPLYBOX.EDITOR.BG_COLOR.${color.key}`, color.name),
      attachTooltip
    );
    tooltipAnchors.push(swatch);
    swatch.style.cssText = [
      "width: 22px",
      "height: 22px",
      "border-radius: 4px",
      "cursor: pointer",
      "border: 1px solid rgba(0,0,0,0.1)",
      `background: ${color.value}`,
      "transition: transform 0.1s",
    ].join(";");
    swatch.addEventListener("mouseenter", () => {
      swatch.style.transform = "scale(1.15)";
    });
    swatch.addEventListener("mouseleave", () => {
      swatch.style.transform = "";
    });
    swatch.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyColor(color.value);
    });
    grid.appendChild(swatch);
  });

  popup.appendChild(grid);

  const clear = document.createElement("div");
  setTooltip(
    clear,
    tr(t, "CONVERSATION.REPLYBOX.EDITOR.CLEAR_FORMATTING", "Clear formatting"),
    attachTooltip
  );
  tooltipAnchors.push(clear);
  clear.style.cssText = [
    "margin-top: 4px",
    "padding: 8px 12px",
    "border-radius: 8px",
    "color: #666",
    "cursor: pointer",
    "display: flex",
    "justify-content: center",
    "align-items: center",
  ].join(";");
  clear.addEventListener("mouseenter", () => {
    clear.style.backgroundColor = "rgba(0,0,0,0.04)";
  });
  clear.addEventListener("mouseleave", () => {
    clear.style.backgroundColor = "";
  });
  clear.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M3.27 5 2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5ZM6 5v.18L8.82 8h2.4l-.93 2.15 2.09 2.09L13.32 8H20V5H6Z"/>' +
    "</svg>";
  clear.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyColor(null);
  });
  popup.appendChild(clear);

  document.body.appendChild(popup);

  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target)) {
        closePopup();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
};

const bgColorItem = (markType, t, attachTooltip, detachTooltip) =>
  new MenuItem({
    title: tr(
      t,
      "CONVERSATION.REPLYBOX.EDITOR.BG_COLOR_LABEL",
      "Background color"
    ),
    icon: icons.bgColor,
    enable() {
      return true;
    },
    run(state, dispatch, view, event) {
      showBgColorPicker(
        view,
        markType,
        t,
        attachTooltip,
        detachTooltip,
        event.currentTarget
      );
      return true;
    },
  });

const HEADING_LEVELS = [
  {
    key: "NORMAL",
    label: "Normal text",
    fontSize: "14px",
    fontWeight: 400,
    level: 0,
  },
  {
    key: "H1",
    label: "Heading 1",
    fontSize: "22px",
    fontWeight: 700,
    level: 1,
  },
  {
    key: "H2",
    label: "Heading 2",
    fontSize: "18px",
    fontWeight: 700,
    level: 2,
  },
  {
    key: "H3",
    label: "Heading 3",
    fontSize: "16px",
    fontWeight: 600,
    level: 3,
  },
];

const showHeadingPicker = (view, schema, t, anchorEl) => {
  document
    .querySelectorAll(".pm-heading-popup")
    .forEach((el) => el.remove());

  const popup = document.createElement("div");
  popup.className = "pm-heading-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.cssText = [
    "position: fixed",
    `top: ${rect.bottom + 4}px`,
    `left: ${rect.left}px`,
    "z-index: 9999",
    "background: rgb(var(--solid-1, 255 255 255))",
    "border: 1px solid rgba(0,0,0,0.12)",
    "border-radius: 12px",
    "padding: 4px",
    "box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.05)",
    "min-width: 180px",
  ].join(";");

  const apply = (level) => {
    const command =
      level === 0
        ? setBlockType(schema.nodes.paragraph)
        : setBlockType(schema.nodes.heading, { level });
    if (command(view.state, view.dispatch)) view.focus();
    popup.remove();
  };

  HEADING_LEVELS.forEach((item) => {
    const row = document.createElement("div");
    // Label is visible inline, no tooltip needed.
    row.style.cssText = [
      "padding: 8px 12px",
      "cursor: pointer",
      "border-radius: 8px",
      `font-size: ${item.fontSize}`,
      `font-weight: ${item.fontWeight}`,
      "line-height: 1.2",
      "color: inherit",
      "transition: background-color 0.1s",
    ].join(";");
    row.textContent = tr(
      t,
      `CONVERSATION.REPLYBOX.HEADING_LEVEL.${item.key}`,
      item.label
    );
    row.addEventListener("mouseenter", () => {
      row.style.backgroundColor = "rgba(0,0,0,0.04)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.backgroundColor = "";
    });
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      apply(item.level);
    });
    popup.appendChild(row);
  });

  document.body.appendChild(popup);

  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
};

// Font-size presets — kept short so the menu remains compact. `key` doubles as
// the i18n suffix and `value` is the CSS font-size written into the mark.
const FONT_SIZE_PRESETS = [
  { key: "XS", label: "Small", value: "12px" },
  { key: "SM", label: "Medium small", value: "14px" },
  { key: "MD", label: "Default", value: "16px" },
  { key: "LG", label: "Large", value: "18px" },
  { key: "XL", label: "Extra large", value: "22px" },
  { key: "XXL", label: "Huge", value: "28px" },
];

const showFontSizePicker = (
  view,
  markType,
  t,
  attachTooltip,
  detachTooltip,
  anchorEl
) => {
  document
    .querySelectorAll(".pm-font-size-popup")
    .forEach((el) => el.remove());

  const popup = document.createElement("div");
  popup.className = "pm-font-size-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.cssText = [
    "position: fixed",
    `top: ${rect.bottom + 4}px`,
    `left: ${rect.left}px`,
    "z-index: 9999",
    "background: rgb(var(--solid-1, 255 255 255))",
    "border: 1px solid rgba(0,0,0,0.12)",
    "border-radius: 12px",
    "padding: 4px",
    "box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.05)",
    "min-width: 160px",
  ].join(";");

  const tooltipAnchors = [];
  const closePopup = () => {
    if (typeof detachTooltip === "function") {
      tooltipAnchors.forEach((el) => detachTooltip(el));
    }
    popup.remove();
  };

  const applySize = (size) => {
    const { from, to, empty } = view.state.selection;
    let tr = view.state.tr;
    if (size === null) {
      tr = empty
        ? tr.removeStoredMark(markType)
        : tr.removeMark(from, to, markType);
    } else if (empty) {
      tr = tr.addStoredMark(markType.create({ size }));
    } else {
      tr = tr
        .removeMark(from, to, markType)
        .addMark(from, to, markType.create({ size }));
    }
    view.dispatch(tr);
    view.focus();
    closePopup();
  };

  FONT_SIZE_PRESETS.forEach((item) => {
    const row = document.createElement("div");
    row.style.cssText = [
      "padding: 6px 12px",
      "cursor: pointer",
      "border-radius: 8px",
      `font-size: ${item.value}`,
      "line-height: 1.2",
      "color: inherit",
      "transition: background-color 0.1s",
    ].join(";");
    row.textContent = tr(
      t,
      `CONVERSATION.REPLYBOX.EDITOR.FONT_SIZE.${item.key}`,
      item.label
    );
    row.addEventListener("mouseenter", () => {
      row.style.backgroundColor = "rgba(0,0,0,0.04)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.backgroundColor = "";
    });
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applySize(item.value);
    });
    popup.appendChild(row);
  });

  const clear = document.createElement("div");
  setTooltip(
    clear,
    tr(t, "CONVERSATION.REPLYBOX.EDITOR.CLEAR_FORMATTING", "Clear formatting"),
    attachTooltip
  );
  tooltipAnchors.push(clear);
  clear.style.cssText = [
    "margin-top: 4px",
    "padding: 8px 12px",
    "border-radius: 8px",
    "color: #666",
    "cursor: pointer",
    "display: flex",
    "justify-content: center",
    "align-items: center",
  ].join(";");
  clear.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M3.27 5 2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5ZM6 5v.18L8.82 8h2.4l-.93 2.15 2.09 2.09L13.32 8H20V5H6Z"/>' +
    "</svg>";
  clear.addEventListener("mouseenter", () => {
    clear.style.backgroundColor = "rgba(0,0,0,0.04)";
  });
  clear.addEventListener("mouseleave", () => {
    clear.style.backgroundColor = "";
  });
  clear.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applySize(null);
  });
  popup.appendChild(clear);

  document.body.appendChild(popup);

  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target)) {
        closePopup();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
};

const fontSizeItem = (markType, t, attachTooltip, detachTooltip) =>
  new MenuItem({
    title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.FONT_SIZE_LABEL", "Font size"),
    icon: icons.fontSize,
    enable() {
      return true;
    },
    run(state, dispatch, view, event) {
      showFontSizePicker(
        view,
        markType,
        t,
        attachTooltip,
        detachTooltip,
        event.currentTarget
      );
      return true;
    },
  });

const headingLevelItem = (schema, t) =>
  new MenuItem({
    title: tr(
      t,
      "CONVERSATION.REPLYBOX.HEADING_LEVEL.LABEL",
      "Heading level"
    ),
    icon: icons.headingLevel,
    enable() {
      return true;
    },
    run(state, dispatch, view, event) {
      showHeadingPicker(view, schema, t, event.currentTarget);
      return true;
    },
  });

const buildMenuOptions = (
  schema,
  {
    enabledMenuOptions = [
      "strong",
      "em",
      "code",
      "link",
      "undo",
      "redo",
      "bulletList",
      "orderedList",
    ],
    onImageUpload = () => {},
    onHtmlEmbed = () => {},
    t,
    attachTooltip,
    detachTooltip,
  }
) => {
  const availableMenuOptions = {
    strong: markItem(schema.marks.strong, {
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.BOLD", "Toggle strong style"),
      icon: icons.strong,
    }),
    em: markItem(schema.marks.em, {
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.ITALIC", "Toggle emphasis"),
      icon: icons.em,
    }),
    underline: schema.marks.underline
      ? markItem(schema.marks.underline, {
          title: tr(
            t,
            "CONVERSATION.REPLYBOX.EDITOR.UNDERLINE",
            "Toggle underline"
          ),
          icon: icons.underline,
        })
      : null,
    textColor: schema.marks.textColor
      ? textColorItem(schema.marks.textColor, t, attachTooltip, detachTooltip)
      : null,
    backgroundColor: schema.marks.backgroundColor
      ? bgColorItem(
          schema.marks.backgroundColor,
          t,
          attachTooltip,
          detachTooltip
        )
      : null,
    fontSize: schema.marks.fontSize
      ? fontSizeItem(schema.marks.fontSize, t, attachTooltip, detachTooltip)
      : null,
    headingLevel: schema.nodes.heading
      ? headingLevelItem(schema, t)
      : null,
    code: markItem(schema.marks.code, {
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.CODE", "Toggle code font"),
      icon: icons.code,
    }),
    link: linkItem(schema.marks.link, t),
    bulletList: toggleListItem(schema.nodes.bullet_list, {
      title: tr(
        t,
        "CONVERSATION.REPLYBOX.EDITOR.BULLET_LIST",
        "Toggle bullet list"
      ),
      icon: icons.bulletList,
    }),
    orderedList: toggleListItem(schema.nodes.ordered_list, {
      title: tr(
        t,
        "CONVERSATION.REPLYBOX.EDITOR.ORDERED_LIST",
        "Toggle ordered list"
      ),
      icon: icons.orderedList,
    }),
    blockquote: schema.nodes.blockquote
      ? blockquoteItem(schema.nodes.blockquote, {
          title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.BLOCKQUOTE", "Blockquote"),
          icon: icons.blockquote,
        })
      : null,
    undo: new MenuItem({
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.UNDO", "Undo last change"),
      run: undo,
      enable: (state) => undo(state),
      icon: icons.undo,
    }),
    redo: new MenuItem({
      title: tr(
        t,
        "CONVERSATION.REPLYBOX.EDITOR.REDO",
        "Redo last undone change"
      ),
      run: redo,
      enable: (state) => redo(state),
      icon: icons.redo,
    }),
    h1: headerItem(schema.nodes.heading, {
      level: 1,
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.H1", "Heading 1"),
      icon: icons.h1,
    }),
    h2: headerItem(schema.nodes.heading, {
      level: 2,
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.H2", "Heading 2"),
      icon: icons.h2,
    }),
    h3: headerItem(schema.nodes.heading, {
      level: 3,
      title: tr(t, "CONVERSATION.REPLYBOX.EDITOR.H3", "Heading 3"),
      icon: icons.h3,
    }),
    imageUpload: imageUploadItem(schema.nodes.image, onImageUpload, t),
    // Only available on schemas that define the html_embed node (article schema).
    htmlEmbed: schema.nodes.html_embed
      ? htmlEmbedItem(onHtmlEmbed, t)
      : null,
  };

  return [
    enabledMenuOptions
      .filter((menuOptionKey) => !!availableMenuOptions[menuOptionKey])
      .map((menuOptionKey) => availableMenuOptions[menuOptionKey]),
  ];
};

export default buildMenuOptions;
