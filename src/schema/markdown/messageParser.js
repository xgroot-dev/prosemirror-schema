import MarkdownIt from 'markdown-it';
import { MarkdownParser } from 'prosemirror-markdown';
import {
  baseSchemaToMdMapping,
  baseNodesMdToPmMapping,
  baseMarksMdToPmMapping,
  filterMdToPmSchemaMapping,
} from './parser';

export const messageSchemaToMdMapping = {
  nodes: {
    ...baseSchemaToMdMapping.nodes,
    heading: ['heading', 'lheading'],
  },
  marks: { ...baseSchemaToMdMapping.marks },
};

export const messageMdToPmMapping = {
  ...baseNodesMdToPmMapping,
  ...baseMarksMdToPmMapping,
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
  fontFamily: {
    mark: 'fontFamily',
    getAttrs: tok => Object.fromEntries(tok.attrs || []),
  },
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
};

// `html: true` so inline `<u>` / `</u>` survive tokenisation as html_inline
// tokens; the core rule below converts only those into underline mark
// open/close tokens, every other html_inline is downgraded to literal text so
// we don't accidentally accept arbitrary inline HTML.
const md = MarkdownIt('commonmark', {
  html: true,
  linkify: false,
});

md.enable([
  // Process html entity - &#123;, &#xAF;, &quot;, ...
  'entity',
  // Process escaped chars and hardbreaks
  'escape',
]);

md.disable(['table', 'hr', 'heading', 'lheading'], true);

const OPEN_U_RE = /^<u(\s[^>]*)?>$/i;
const CLOSE_U_RE = /^<\/u\s*>$/i;
const OPEN_SPAN_RE = /^<span\s+style\s*=\s*"([^"]*)"\s*>$/i;
const CLOSE_SPAN_RE = /^<\/span\s*>$/i;

// Single style on the opening span -> single mark. We keep the rule strict
// (one declaration) so we don't have to manage overlapping pairs of opens
// and closes for combined styles. The serializer already nests separate
// spans per mark, so this is sufficient for round-tripping our own output.
const STYLE_PATTERNS = [
  {
    re: /color\s*:\s*([^;]+)/i,
    mark: 'textColor',
    attr: m => ({ color: m[1].trim() }),
  },
  {
    re: /background-color\s*:\s*([^;]+)/i,
    mark: 'backgroundColor',
    attr: m => ({ backgroundColor: m[1].trim() }),
  },
  {
    re: /font-size\s*:\s*([^;]+)/i,
    mark: 'fontSize',
    attr: m => ({ size: m[1].trim() }),
  },
  {
    re: /font-family\s*:\s*([^;]+)/i,
    mark: 'fontFamily',
    attr: m => ({ family: m[1].trim() }),
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

export class MessageMarkdownTransformer {
  constructor(schema, tokenizer = md) {
    // Enable markdown plugins based on schema
    ['nodes', 'marks'].forEach(key => {
      for (const idx in messageSchemaToMdMapping[key]) {
        if (schema[key][idx]) {
          tokenizer.enable(messageSchemaToMdMapping[key][idx]);
        }
      }
    });

    this.markdownParser = new MarkdownParser(
      schema,
      tokenizer,
      filterMdToPmSchemaMapping(schema, messageMdToPmMapping)
    );
  }
  encode(_node) {
    throw new Error('This is not implemented yet');
  }

  parse(content) {
    return this.markdownParser.parse(content);
  }
}
