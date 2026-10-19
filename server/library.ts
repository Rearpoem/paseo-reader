import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { bookSchema, preferencesSchema, type Book, type Position, type Preferences } from "../shared/library";
import { parseTxt, parseEpub, type ParsedBook } from "./parse";

const dataDir = path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "plugin-data", "novel-reader");
const indexPath = path.join(dataDir, "library.json");
const indexSchema = z.object({ version: z.literal(1), books: z.array(bookSchema), preferences: preferencesSchema });
type Library = z.infer<typeof indexSchema>;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, ParsedBook>();

async function atomicWrite(filename: string, data: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 }); await fs.rename(temporary, filename); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

async function load(): Promise<Library> {
  try { return indexSchema.parse(JSON.parse(await fs.readFile(indexPath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, books: [], preferences: preferencesSchema.parse({}) };
    throw new Error("书架数据无法读取。已保留原文件，请检查小说插件的数据目录。");
  }
}

function mutate<T>(fn: (library: Library) => Promise<T> | T): Promise<T> {
  const next = queue.then(async () => { const library = await load(); const result = await fn(library); await atomicWrite(indexPath, library); return result; });
  queue = next.catch(() => {});
  return next;
}

export async function list() {
  await queue;
  const library = await load();
  return { books: library.books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)), preferences: library.preferences };
}

function expandPath(input: string) {
  const value = input.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (!path.isAbsolute(value)) throw new Error("请输入完整文件路径，或以 ~/ 开头的路径。");
  return path.normalize(value);
}

export async function browse({ path: input, query }: { path: string; query: string }) {
  const directory = expandPath(input);
  try {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .filter(item => !item.name.startsWith(".") && (item.isDirectory() || item.isFile() && /\.(txt|epub)$/i.test(item.name)))
      .filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map(item => ({ name: item.name, path: path.join(directory, item.name), directory: item.isDirectory() }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, "zh-Hans"));
    return { path: directory, parent: path.dirname(directory), entries: entries.slice(0, 500), truncated: entries.length > 500 };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error("找不到这个文件夹。可以输入小说的完整路径后直接导入。");
    throw new Error("无法打开文件夹，请检查文件夹权限或选择其他位置。");
  }
}

export async function importFile({ path: input, encoding }: { path: string; encoding: string }) {
  const source = expandPath(input);
  const extension = path.extname(source).toLowerCase();
  if (![".txt", ".epub"].includes(extension)) throw new Error("目前支持 TXT 和 EPUB，请选择对应格式的小说文件。");
  let bytes: Buffer;
  try {
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error("NOT_FILE");
    if (stat.size > 50 * 1024 * 1024) throw new Error("TOO_LARGE");
    bytes = await fs.readFile(source);
    if (bytes.length > 50 * 1024 * 1024) throw new Error("TOO_LARGE");
  } catch (error) {
    if ((error as Error).message === "TOO_LARGE") throw new Error("单本文件上限为 50 MB，请拆分或压缩正文后导入。");
    throw new Error("找不到小说文件或无法读取。请检查路径和文件权限。");
  }
  const parsed = extension === ".epub" ? parseEpub(bytes, source) : parseTxt(bytes, source, encoding);
  const id = createHash("sha256").update(bytes).update(parsed.encoding).digest("hex").slice(0, 24);
  return mutate(async library => {
    const existing = library.books.find(book => book.id === id);
    if (existing) return { book: existing, duplicate: true };
    const book: Book = { id, title: parsed.title, author: parsed.author, format: extension === ".epub" ? "EPUB" : "TXT", filename: path.basename(source), encoding: parsed.encoding,
      pageCount: parsed.pages.length, chapterCount: parsed.chapters.length, addedAt: Date.now(), lastReadAt: 0, position: { page: 0, offset: 0 } };
    await atomicWrite(path.join(dataDir, "books", `${id}.json`), parsed);
    library.books.push(book);
    return { book, duplicate: false };
  });
}

export async function page({ id, page: number }: { id: string; page: number }) {
  await queue;
  const library = await load();
  const book = library.books.find(book => book.id === id);
  if (!book) throw new Error("这本小说不在书架里，请返回书架后重新导入。");
  if (number >= book.pageCount) throw new Error("已经到最后一页了。");
  let parsed = cache.get(id);
  if (!parsed) {
    try { parsed = JSON.parse(await fs.readFile(path.join(dataDir, "books", `${id}.json`), "utf8")) as ParsedBook; }
    catch { throw new Error("正文缓存无法读取，请检查本地小说数据文件。"); }
    if (cache.size >= 3) cache.delete(cache.keys().next().value!);
    cache.set(id, parsed);
  }
  return { book, page: number, ...parsed.pages[number], chapters: parsed.chapters };
}

export async function position({ id, position }: { id: string; position: Position }) {
  return mutate(library => {
    const book = library.books.find(book => book.id === id);
    if (!book) throw new Error("找不到要保存进度的小说。");
    if (position.page >= book.pageCount) throw new Error("阅读位置超出书籍范围。");
    book.position = position; book.lastReadAt = Date.now();
    return { ok: true };
  });
}

export async function preferences(values: Preferences) {
  return mutate(library => { library.preferences = values; return values; });
}
