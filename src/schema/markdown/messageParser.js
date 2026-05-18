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

md.core.ruler.after('inline', 'underline_html_inline', state => {
  state.tokens.forEach(blockToken => {
    if (blockToken.type !== 'inline' || !blockToken.children) return;
    const next = [];
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
