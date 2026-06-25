export const mention = (state, node) => {
  const uri = state.esc(
    `mention://user/${node.attrs.userId}/${encodeURIComponent(
      node.attrs.userFullName
    )}`
  );
  const escapedDisplayName = state.esc('@' + (node.attrs.userFullName || ''));

  state.write(`[${escapedDisplayName}](${uri})`);
};

export const blockquote = (state, node) => {
  state.wrapBlock('> ', null, node, () => state.renderContent(node));
};
export const code_block = (state, node) => {
  state.write('```' + (node.attrs.params || '') + '\n');
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write('```');
  state.closeBlock(node);
};
export const heading = (state, node) => {
  state.write(state.repeat('#', node.attrs.level) + ' ');
  state.renderInline(node);
  state.closeBlock(node);
};
export const horizontal_rule = (state, node) => {
  state.write(node.attrs.markup || '---');
  state.closeBlock(node);
};
export const bullet_list = (state, node) => {
  state.renderList(node, '  ', () => (node.attrs.bullet || '*') + ' ');
};
export const ordered_list = (state, node) => {
  let start = node.attrs.order || 1;
  let maxW = String(start + node.childCount - 1).length;
  let space = state.repeat(' ', maxW + 2);
  state.renderList(node, space, i => {
    let nStr = String(start + i);
    return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
  });
};
export const list_item = (state, node) => {
  state.renderContent(node);
};
export const paragraph = (state, node) => {
  state.renderInline(node);
  state.closeBlock(node);
};
export const image = (state, node) => {
  let src = state.esc(node.attrs.src);
  if (node.attrs.height) {
    const param = `cw_image_height=${node.attrs.height}`;
    if (src.includes('?')) {
      src = src.includes('cw_image_height=') ?
        src.replace(/cw_image_height=[^&]+/, param) : `${src}&${param}`;
    } else {
      src += `?${param}`;
    }
  }
  // Article images carry their preset size in `style`: a fixed px size as
  // `max-width: <N>px`, or a full-column size as `width: <N>%`. Encode it on the
  // src as cw_image_width=<N>px | <N>pct (pct avoids a literal % in the URL).
  // Normalise (strip any existing param) then re-apply, so clearing the size
  // (style null on "Original") also drops the query param.
  src = src.replace(/[?&]cw_image_width=[^&]*/g, '');
  if (!src.includes('?') && src.includes('&')) src = src.replace('&', '?');
  const style = node.attrs.style || '';
  const pxMatch = style.match(/max-width:\s*(\d+)px/);
  const pctMatch = style.match(/width:\s*(\d+)%/);
  const sizeParam = pxMatch
    ? `${pxMatch[1]}px`
    : pctMatch
      ? `${pctMatch[1]}pct`
      : null;
  if (sizeParam) {
    const param = `cw_image_width=${sizeParam}`;
    src += src.includes('?') ? `&${param}` : `?${param}`;
  }
  state.write(
    '![' +
      state.esc(node.attrs.alt || '') +
      '](' +
      src +
      (node.attrs.title ? ' ' + state.quote(node.attrs.title) : '') +
      ')'
  );
};
export const hard_break = (state, node, parent, index) => {
  for (let i = index + 1; i < parent.childCount; i++)
    if (parent.child(i).type !== node.type) {
      state.write('  \n');
      return;
    }
};
export const text = (state, node) => {
  state.text(node.text, false);
};
export const internal_note = (state, node) => {
  state.write(`<div class="internal_note">${node.attrs.text}</div>`);
  state.closeBlock(node);
};
export const html_embed = (state, node) => {
  // Emit the raw markup verbatim (newlines preserved) inside a recognizable
  // wrapper so it round-trips back into an html_embed node on re-parse.
  state.write(`<div class="html-embed">${node.attrs.html}</div>`);
  state.closeBlock(node);
};

export const em = {
  open: '*',
  close: '*',
  mixable: true,
  expelEnclosingWhitespace: true,
};
export const superscript = {
  open: '^',
  close: '^',
  mixable: false,
  escape: false,
  expelEnclosingWhitespace: false,
};
export const strike = {
  open: '~~',
  close: '~~',
  mixable: true,
  expelEnclosingWhitespace: true,
};
export const underline = {
  open: '<u>',
  close: '</u>',
  mixable: true,
  expelEnclosingWhitespace: true,
  escape: false,
};
export const strong = {
  open: '**',
  close: '**',
  mixable: true,
  expelEnclosingWhitespace: true,
};
export const link = {
  open(_state, mark, parent, index) {
    return isPlainURL(mark, parent, index, 1) ? '<' : '[';
  },
  close(state, mark, parent, index) {
    return isPlainURL(mark, parent, index, -1)
      ? '>'
      : '](' +
          state.esc(mark.attrs.href) +
          (mark.attrs.title ? ' ' + state.quote(mark.attrs.title) : '') +
          ')';
  },
  escape: false,
};
export const code = {
  open(_state, _mark, parent, index) {
    return backticksFor(parent.child(index), -1);
  },
  close(_state, _mark, parent, index) {
    return backticksFor(parent.child(index - 1), 1);
  },
  escape: false,
};
export const textColor = {
  open: (_state, mark) => `<span style="color: ${mark.attrs.color}">`,
  close: '</span>',
  mixable: true,
  expelEnclosingWhitespace: true,
  escape: false,
};
export const backgroundColor = {
  open: (_state, mark) =>
    `<span style="background-color: ${mark.attrs.backgroundColor}">`,
  close: '</span>',
  mixable: true,
  expelEnclosingWhitespace: true,
  escape: false,
};
export const fontSize = {
  open: (_state, mark) => `<span style="font-size: ${mark.attrs.size}">`,
  close: '</span>',
  mixable: true,
  expelEnclosingWhitespace: true,
  escape: false,
};
export const fontFamily = {
  open: (_state, mark) => `<span style="font-family: ${mark.attrs.family}">`,
  close: '</span>',
  mixable: true,
  expelEnclosingWhitespace: true,
  escape: false,
};

function backticksFor(node, side) {
  let ticks = /`+/g,
    m,
    len = 0;
  if (node.isText)
    while ((m = ticks.exec(node.text))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}

function isPlainURL(link, parent, index, side) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) return false;
  let content = parent.child(index + (side < 0 ? -1 : 0));
  if (
    !content.isText ||
    content.text != link.attrs.href ||
    content.marks[content.marks.length - 1] != link
  )
    return false;
  if (index == (side < 0 ? 1 : parent.childCount - 1)) return true;
  let next = parent.child(index + (side < 0 ? -2 : 1));
  return !link.isInSet(next.marks);
}
