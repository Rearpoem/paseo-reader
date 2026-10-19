import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const bookId = z.string().regex(/^[a-f0-9]{24}$/);
export const positionSchema = z.object({ page: z.number().int().min(0), offset: z.number().min(0).max(1) });
export const preferencesSchema = z.object({
  fontSize: z.number().int().min(16).max(32).default(22),
  lineHeight: z.number().min(1.4).max(2.4).default(1.9),
  serif: z.boolean().default(true),
});
export const bookSchema = z.object({
  id: bookId, title: z.string(), author: z.string(), format: z.enum(["TXT", "EPUB"]),
  filename: z.string(), encoding: z.string(), pageCount: z.number().int(), chapterCount: z.number().int(),
  addedAt: z.number(), lastReadAt: z.number(), position: positionSchema,
});
export type Book = z.infer<typeof bookSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Position = z.infer<typeof positionSchema>;
export const listBooks = defineRpc({ name: "library.list", input: z.object({}),
  output: z.object({ books: z.array(bookSchema), preferences: preferencesSchema }) });
export const browseFiles = defineRpc({ name: "library.browse", input: z.object({ path: z.string().max(4096).default("~"), query: z.string().max(200).default("") }),
  output: z.object({ path: z.string(), parent: z.string(), entries: z.array(z.object({ name: z.string(), path: z.string(), directory: z.boolean() })), truncated: z.boolean() }) });
export const importBook = defineRpc({ name: "library.import", input: z.object({ path: z.string().min(1).max(4096), encoding: z.enum(["auto", "utf-8", "gb18030", "utf-16le", "utf-16be"]).default("auto") }),
  output: z.object({ book: bookSchema, duplicate: z.boolean() }) });
export const readPage = defineRpc({ name: "library.page", input: z.object({ id: bookId, page: z.number().int().min(0) }),
  output: z.object({ book: bookSchema, title: z.string(), text: z.string(), page: z.number().int(), chapters: z.array(z.object({ title: z.string(), page: z.number().int() })) }) });
export const savePosition = defineRpc({ name: "library.position", input: z.object({ id: bookId, position: positionSchema }), output: z.object({ ok: z.boolean() }) });
export const savePreferences = defineRpc({ name: "library.preferences", input: preferencesSchema, output: preferencesSchema });
