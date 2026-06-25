import { MarkdownSerializer as MarkdownSerializerBase } from 'prosemirror-markdown';

import {
  blockquote,
  code_block,
  heading,
  horizontal_rule,
  bullet_list,
  ordered_list,
  list_item,
  paragraph,
  image,
  hard_break,
  text,
  internal_note,
  html_embed,
  em,
  superscript,
  strike,
  strong,
  underline,
  link,
  code,
} from './serializer';

export const ArticleMarkdownSerializer = new MarkdownSerializerBase(
  {
    blockquote,
    code_block,
    heading,
    horizontal_rule,
    bullet_list,
    ordered_list,
    list_item,
    paragraph,
    image,
    hard_break,
    text,
    internal_note,
    html_embed,
  },
  {
    em,
    superscript,
    strike,
    strong,
    underline,
    link,
    code,
  }
);
