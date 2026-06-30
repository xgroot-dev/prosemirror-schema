import MarkdownIt from 'markdown-it';
import MarkdownItSup from 'markdown-it-sup';
import { MarkdownParser } from 'prosemirror-markdown';
import {
  baseSchemaToMdMapping,
  baseNodesMdToPmMapping,
  baseMarksMdToPmMapping,
  filterMdToPmSchemaMapping,
} from './parser';

export const articleSchemaToMdMapping = {
  nodes: {
    ...baseSchemaToMdMapping.nodes,
    rule: 'hr',
    heading: ['heading'],
    image: 'image',
  },
  marks: { ...baseSchemaToMdMapping.marks },
};

export const articleMdToPmMapping = {
  ...baseNodesMdToPmMapping,
  ...baseMarksMdToPmMapping,
  // Inline styling marks produced by the styled_html_inline core rule below.
  underline: { mark: 'underline' },
  textColor: {
    mark: 'textColor',
    getAttrs: tok => Object.fromEntries(tok.attrs || []),
  },
  backgroundColor: {
    mark: 'backgroundColor',
    getAttrs: tok => Object.fromEntries(tok.attrs || []),
  },
  fontSize: {
    mark: 'fontSize',
    getAttrs: tok => Object.fromEntries(tok.attrs || []),
  },
  hr: { node: 'horizontal_rule' },
  heading: {
    block: 'heading',
    attrs: tok => ({ level: +tok.tag.slice(1) }),
  },
  mention: {
    node: 'mention',
    getAttrs: ({ mention }) => {
      const { userId, userFullName } = mention;
      return { userId, userFullName };
    },
  },
  internal_note: {
    node: 'internal_note',
    getAttrs: tok => ({ text: tok.content }),
  },
  html_embed: {
    node: 'html_embed',
    getAttrs: tok => ({ html: tok.content }),
  },
};

// `html: true` so inline `<u>` / `<span style="…">` survive tokenisation as
// html_inline tokens; the styled_html_inline core rule below converts only those
// into mark open/close tokens, every other html_inline is downgraded to literal
// text so we don't accept arbitrary inline HTML. `html_block` is disabled so the
// custom <div class="internal_note"> / <div class="html-embed"> block rules below
// keep handling those wrappers (markdown-it's html_block would otherwise swallow
// them and emit tokens the parser can't map).
const md = MarkdownIt('commonmark', {
  html: true,
  linkify: true,
  breaks: true,
}).use(MarkdownItSup);

md.enable([
  // Process html entity - &#123;, &#xAF;, &quot;, ...
  'entity',
  // Process escaped chars and hardbreaks
  'escape',
  'hr',
]);

md.disable(['html_block']);

const OPEN_U_RE = /^<u(\s[^>]*)?>$/i;
const CLOSE_U_RE = /^<\/u\s*>$/i;
const OPEN_SPAN_RE = /^<span\s+style\s*=\s*"([^"]*)"\s*>$/i;
const CLOSE_SPAN_RE = /^<\/span\s*>$/i;

// Single style on the opening span -> single mark. The serializer nests a
// separate span per mark, so each opening tag carries exactly one declaration.
// Patterns are anchored (^…$) so `color` doesn't match inside `background-color`
// (and background-color is listed first as an extra guard).
const STYLE_PATTERNS = [
  {
    re: /^background-color\s*:\s*(.+)$/i,
    mark: 'backgroundColor',
    attr: m => ({ backgroundColor: m[1].trim() }),
  },
  {
    re: /^color\s*:\s*(.+)$/i,
    mark: 'textColor',
    attr: m => ({ color: m[1].trim() }),
  },
  {
    re: /^font-size\s*:\s*(.+)$/i,
    mark: 'fontSize',
    attr: m => ({ size: m[1].trim() }),
  },
];

const styledSpanMark = styleAttr => {
  for (const { re, mark, attr } of STYLE_PATTERNS) {
    const match = re.exec(styleAttr);
    if (match) return { mark, attrs: attr(match) };
  }
  return null;
};

md.core.ruler.after('inline', 'styled_html_inline', state => {
  state.tokens.forEach(blockToken => {
    if (blockToken.type !== 'inline' || !blockToken.children) return;
    const next = [];
    const openStack = []; // pushed when we open a styled span; popped on close
    blockToken.children.forEach(token => {
      if (token.type !== 'html_inline') {
        next.push(token);
        return;
      }
      if (OPEN_U_RE.test(token.content)) {
        const open = new state.Token('underline_open', 'u', 1);
        open.markup = '<u>';
        next.push(open);
        return;
      }
      if (CLOSE_U_RE.test(token.content)) {
        const close = new state.Token('underline_close', 'u', -1);
        close.markup = '</u>';
        next.push(close);
        return;
      }
      const openSpan = OPEN_SPAN_RE.exec(token.content);
      if (openSpan) {
        const styled = styledSpanMark(openSpan[1]);
        if (styled) {
          const open = new state.Token(`${styled.mark}_open`, 'span', 1);
          open.attrs = Object.entries(styled.attrs);
          openStack.push(styled.mark);
          next.push(open);
          return;
        }
      }
      if (CLOSE_SPAN_RE.test(token.content) && openStack.length) {
        const markName = openStack.pop();
        const close = new state.Token(`${markName}_close`, 'span', -1);
        next.push(close);
        return;
      }
      const textToken = new state.Token('text', '', 0);
      textToken.content = token.content;
      next.push(textToken);
    });
    blockToken.children = next;
  });
});

// Custom block rule: round-trip a single-line <div class="internal_note">…</div>
// into one internal_note token without enabling the global html flag.
md.block.ruler.before(
  'paragraph',
  'internal_note',
  (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    const m = line.match(/^<div class="internal_note">([\s\S]*?)<\/div>\s*$/);
    if (!m) return false;
    if (silent) return true;
    const token = state.push('internal_note', 'div', 0);
    token.block = true;
    token.content = m[1];
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  },
  // Act as a paragraph/blockquote/list terminator so the rule also fires when
  // the div immediately follows a line of text (no blank line in between).
  { alt: ['paragraph', 'blockquote', 'list'] }
);

// Custom block rule: round-trip a (possibly multi-line) raw HTML embed wrapped
// in <div class="html-embed">…</div> into one html_embed token, without
// enabling the global html flag. Raw embeds (iframes, scripts, widgets) often
// span several lines, so scan until the line that closes the wrapper.
md.block.ruler.before(
  'paragraph',
  'html_embed',
  (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const firstLine = state.src.slice(start, state.eMarks[startLine]);
    if (!/^<div class="html-embed">/.test(firstLine)) return false;

    // Find the line that closes the wrapper by tracking <div>/</div> nesting
    // depth, so embeds containing nested <div>s (e.g. a video wrapper around an
    // iframe) don't terminate early on the first inner </div>. The wrapper is
    // closed on the line where depth returns to 0.
    let depth = 0;
    let nextLine = startLine;
    for (; nextLine < endLine; nextLine++) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineText = state.src.slice(lineStart, state.eMarks[nextLine]);
      depth += (lineText.match(/<div\b/g) || []).length;
      depth -= (lineText.match(/<\/div\b/g) || []).length;
      if (depth <= 0) break;
    }
    if (nextLine >= endLine) return false;

    const block = state.src.slice(start, state.eMarks[nextLine]);
    const m = block.match(/^<div class="html-embed">([\s\S]*?)<\/div>\s*$/);
    if (!m) return false;
    if (silent) return true;

    const token = state.push('html_embed', 'div', 0);
    token.block = true;
    token.content = m[1];
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  },
  { alt: ['paragraph', 'blockquote', 'list'] }
);

export class ArticleMarkdownTransformer {
  constructor(schema, tokenizer = md) {
    // Enable markdown plugins based on schema
    ['nodes', 'marks'].forEach(key => {
      for (const idx in articleSchemaToMdMapping[key]) {
        if (schema[key][idx]) {
          tokenizer.enable(articleSchemaToMdMapping[key][idx]);
        }
      }
    });

    this.markdownParser = new MarkdownParser(
      schema,
      tokenizer,
      filterMdToPmSchemaMapping(schema, articleMdToPmMapping)
    );
  }
  encode(_node) {
    throw new Error('This is not implemented yet');
  }

  parse(content) {
    return this.markdownParser.parse(content);
  }
}
