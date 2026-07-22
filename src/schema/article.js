import { orderedList, bulletList, listItem } from 'prosemirror-schema-list';
import { Schema } from 'prosemirror-model';
import { schema } from 'prosemirror-markdown';

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
    // Inline named anchor: an empty, atomic jump target the author drops at the
    // cursor (or in front of a selection) so links can point to `#<name>` inside
    // the article. Persisted to markdown as an empty <a id="…" class="cw-anchor">
    // tag (see markdown/serializer.js) and round-tripped back by the
    // styled_html_inline core rule in markdown/articleParser.js. In the editor it
    // shows as a small pill (CSS ::after on data-anchor); on the published portal
    // it renders as an invisible in-page target (the id).
    anchor: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      draggable: false,
      attrs: { name: { default: '' } },
      parseDOM: [
        {
          tag: 'a.cw-anchor',
          getAttrs: dom => ({
            name: dom.getAttribute('data-anchor') || dom.getAttribute('id') || '',
          }),
        },
      ],
      toDOM: node => [
        'a',
        { class: 'cw-anchor', 'data-anchor': node.attrs.name },
      ],
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
    // Inline styling marks matching messageSchema so the article editor offers
    // the same colour/underline formatting as the reply box. Defined inline
    // (rather than reused via messageSchema.spec.marks.get) because the marks must
    // exist the moment this Schema is constructed — pulling them from another
    // schema module is fragile under ESM bundling (init order can leave them
    // undefined). These persist to markdown as inline <span style="…"> / <u> (see
    // markdown/articleSerializer.js) and round-trip back via markdown/articleParser.js.
    underline: {
      parseDOM: [
        { tag: 'u' },
        {
          style: 'text-decoration',
          getAttrs: value => value === 'underline' && null,
        },
      ],
      toDOM: () => ['u', 0],
    },
    textColor: {
      attrs: { color: {} },
      parseDOM: [
        {
          tag: 'span[style*="color"]',
          getAttrs: dom => {
            const color = dom.style.color;
            return color ? { color } : false;
          },
        },
      ],
      toDOM: mark => ['span', { style: `color: ${mark.attrs.color}` }, 0],
    },
    backgroundColor: {
      attrs: { backgroundColor: {} },
      parseDOM: [
        {
          tag: 'span[style*="background-color"]',
          getAttrs: dom => {
            const backgroundColor = dom.style.backgroundColor;
            return backgroundColor ? { backgroundColor } : false;
          },
        },
      ],
      toDOM: mark => [
        'span',
        { style: `background-color: ${mark.attrs.backgroundColor}` },
        0,
      ],
    },
  },
});

export default fullSchema;
