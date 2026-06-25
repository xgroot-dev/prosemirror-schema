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

const md = MarkdownIt('commonmark', {
  html: false,
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

    // Find the line whose end closes the wrapper (handles single- and
    // multi-line embeds; closing </div> must be the last thing on its line).
    let nextLine = startLine;
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineText = state.src.slice(lineStart, state.eMarks[nextLine]);
      if (/<\/div>\s*$/.test(lineText)) break;
      nextLine++;
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
