import { MarkdownSerializer as MarkdownSerializerBase } from 'prosemirror-markdown';

import {
  mention,
  blockquote,
  code_block,
  heading,
  bullet_list,
  ordered_list,
  list_item,
  paragraph,
  image,
  hard_break,
  text,
  em,
  strike,
  strong,
  underline,
  link,
  code,
} from './serializer';

export const MessageMarkdownSerializer = new MarkdownSerializerBase(
  {
    mention,
    blockquote,
    code_block,
    heading,
    bullet_list,
    ordered_list,
    list_item,
    paragraph,
    image,
    hard_break,
    text,
  },
  {
    em,
    strike,
    strong,
    underline,
    link,
    code,
  }
);
