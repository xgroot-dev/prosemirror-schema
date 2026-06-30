import { orderedList, bulletList, listItem } from 'prosemirror-schema-list';
import { Schema } from 'prosemirror-model';
import { schema } from 'prosemirror-markdown';
import { messageSchema } from './message';

export const fullSchema = new Schema({
  nodes: {
    doc: schema.spec.nodes.get('doc'),
    paragraph: schema.spec.nodes.get('paragraph'),
    blockquote: schema.spec.nodes.get('blockquote'),
    horizontal_rule: schema.spec.nodes.get('horizontal_rule'),
    heading: schema.spec.nodes.get('heading'),
    code_block: schema.spec.nodes.get('code_block'),
    text: schema.spec.nodes.get('text'),
    // Image node extended with a `style` attribute so a predefined size
    // (max-width in px) can be applied in the article editor. The size is
    // persisted to markdown as a `cw_image_width=<N>px` query param on the
    // src (see markdown/serializer.js + markdown/parser.js) because markdown
    // can't hold inline styles.
    image: {
      ...schema.spec.nodes.get('image'),
      attrs: {
        ...schema.spec.nodes.get('image').attrs,
        style: { default: null },
      },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: dom => ({
            src: dom.getAttribute('src'),
            title: dom.getAttribute('title'),
            alt: dom.getAttribute('alt'),
            style: dom.getAttribute('style'),
          }),
        },
      ],
      toDOM: node => {
        const attrs = { src: node.attrs.src };
        if (node.attrs.alt) attrs.alt = node.attrs.alt;
        if (node.attrs.title) attrs.title = node.attrs.title;
        if (node.attrs.style) attrs.style = node.attrs.style;
        return ['img', attrs];
      },
    },
    hard_break: schema.spec.nodes.get('hard_break'),
    ordered_list: Object.assign(orderedList, {
      content: 'list_item+',
      group: 'block',
    }),
    bullet_list: Object.assign(bulletList, {
      content: 'list_item+',
      group: 'block',
    }),
    list_item: Object.assign(listItem, { content: 'paragraph block*' }),
    internal_note: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { text: { default: '' } },
      parseDOM: [
        {
          tag: 'div.internal_note',
          getAttrs: dom => ({ text: dom.textContent || '' }),
        },
      ],
      toDOM: node => ['div', { class: 'internal_note' }, node.attrs.text],
    },
    html_embed: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { html: { default: '' } },
      parseDOM: [
        {
          tag: 'div.html-embed',
          getAttrs: dom => ({ html: dom.textContent || '' }),
        },
      ],
      // Render the raw markup as text so authors see (and edit) the source
      // instead of a live, rendered embed inside the editor.
      toDOM: node => ['div', { class: 'html-embed' }, node.attrs.html],
    },
  },
  marks: {
    link: schema.spec.marks.get('link'),
    em: schema.spec.marks.get('em'),
    superscript: {
      parseDOM: [{ tag: 'sup' }],
      toDOM() {
        return ['sup'];
      },
    },
    strong: schema.spec.marks.get('strong'),
    code: schema.spec.marks.get('code'),
    strike: {
      parseDOM: [
        { tag: 's' },
        { tag: 'del' },
        { tag: 'strike' },
        {
          style: 'text-decoration',
          getAttrs: value => value === 'line-through',
        },
      ],
      toDOM: () => ['s', 0],
    },
    // Inline styling marks reused verbatim from messageSchema so the article
    // editor offers the same colour/size/underline formatting as the reply box.
    // These persist to markdown as inline <span style="…"> / <u> (see
    // markdown/articleSerializer.js) and round-trip back via markdown/articleParser.js.
    underline: messageSchema.spec.marks.get('underline'),
    textColor: messageSchema.spec.marks.get('textColor'),
    backgroundColor: messageSchema.spec.marks.get('backgroundColor'),
    fontSize: messageSchema.spec.marks.get('fontSize'),
  },
});

export default fullSchema;
