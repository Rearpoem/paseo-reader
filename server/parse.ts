import { unzipSync } from "fflate";
import { parseDocument, DomUtils } from "htmlparser2";
import { XMLParser } from "fast-xml-parser";
import path from "node:path";

export type Page = { title: string; text: string };
export type ParsedBook = { title: string; author: string; encoding: string; pages: Page[]; chapters: { title: string; page: number }[] };
const MAX_TEXT = 30_000_000;
const PAGE_SIZE = 2200;
const clean = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function paginate(title: string, text: string): Page[] {
  let rest = clean(text);
  const pages: Page[] = [];
  while (rest) {
    let end = Math.min(PAGE_SIZE, rest.length);
    if (rest.length > end) {
      const line = rest.lastIndexOf("\n", end);
      if (line > end * 0.5) end = line + 1;
      else {
        for (let i = end; i > end * 0.75; i--) {
          if (/[。！？.!?]/.test(rest[i])) { end = i + 1; break; }
        }
      }
      // Never split a UTF-16 surrogate pair.
      const code = rest.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    pages.push({ title, text: rest.slice(0, end).trim() });
    rest = rest.slice(end).trimStart();
  }
  return pages;
}

export function parseTxt(bytes: Uint8Array, filename: string, requested: string): ParsedBook {
  let encoding = requested;
  let text: string;
  if (encoding === "auto") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    else {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); encoding = "utf-8"; }
      catch { encoding = "gb18030"; }
    }
  }
  try { text = clean(new TextDecoder(encoding, { fatal: true }).decode(bytes)); }
  catch { throw new Error("TXT 编码无法识别。请在导入时手动选择 UTF-8、GB18030 或 UTF-16。"); }
  if (!text || text.length > MAX_TEXT) throw new Error(text ? "小说正文超过 3000 万字符，请拆分后导入。" : "这个 TXT 没有可阅读的文字。");
  const title = path.basename(filename, path.extname(filename));
  const chapterPattern = /^\s*(?:第[零〇一二三四五六七八九十百千万两\d０-９]+[章节回卷部集篇].{0,60}|(?:chapter|part)\s+[\divxlc]+.{0,60}|序章.{0,40}|楔子.{0,40}|尾声.{0,40}|后记.{0,40})\s*$/gim;
  const matches = [...text.matchAll(chapterPattern)];
  const chunks: { title: string; text: string }[] = [];
  if (matches.length) {
    if ((matches[0].index ?? 0) > 0 && text.slice(0, matches[0].index).trim()) chunks.push({ title: "卷首", text: text.slice(0, matches[0].index) });
    matches.forEach((match, i) => chunks.push({ title: match[0].trim(), text: text.slice(match.index! + match[0].length, matches[i + 1]?.index ?? text.length).trim() || match[0].trim() }));
  } else chunks.push({ title: "正文", text });
  return assemble(title, "", encoding.toUpperCase(), chunks);
}

function htmlText(html: string): { title: string; text: string } {
  const document = parseDocument(html, { decodeEntities: true });
  const body = DomUtils.findOne(n => n.name === "body", document.children, true);
  const root = body ?? document;
  const heading = DomUtils.findOne(n => /^(h1|h2|h3)$/.test(n.name), root.children, true);
  const title = heading ? clean(DomUtils.textContent(heading)) : "";
  const parts: string[] = [];
  const visit = (node: (typeof document.children)[number]) => {
    if (node.type === "text") { parts.push(node.data.replace(/\s+/g, " ")); return; }
    if (!("children" in node)) return;
    const tag = "name" in node ? node.name.toLowerCase() : "";
    if (["script", "style", "head", "noscript", "svg"].includes(tag)) return;
    if (tag === "br") { parts.push("\n"); return; }
    const block = /^(p|div|h[1-6]|li|section|article|blockquote|tr)$/.test(tag);
    if (block) parts.push("\n\n");
    node.children.forEach(visit);
    if (block) parts.push("\n\n");
  };
  root.children.forEach(visit);
  return { title, text: clean(parts.join("").replace(/ *\n */g, "\n")) };
}

export function parseEpub(bytes: Uint8Array, filename: string): ParsedBook {
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter(file) {
      if (++count > 20000) throw new Error("Too many entries");
      if (!/\.(xml|opf|ncx|xhtml|html|htm|txt)$/i.test(file.name) && file.name !== "mimetype") return false;
      total += file.originalSize;
      if (file.originalSize > 16_000_000 || total > 80_000_000) throw new Error("Expanded EPUB exceeds limit");
      return true;
    } });
  } catch { throw new Error("EPUB 无法解压，文件可能损坏、加密或过大。"); }
  const decode = (name: string) => {
    const file = files[name];
    if (!file) throw new Error(`EPUB 缺少文件：${name}`);
    return new TextDecoder("utf-8", { fatal: false }).decode(file);
  };
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });
  const list = <T,>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
  const valueText = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : value && typeof value === "object" ? valueText((value as Record<string, unknown>)["#text"]) : "";
  let opfPath: string;
  let pkg: any;
  try {
    const container = parser.parse(decode("META-INF/container.xml"));
    opfPath = list<any>(container.container?.rootfiles?.rootfile)[0]?.["@_full-path"];
    if (!opfPath) throw new Error("Missing rootfile");
    pkg = parser.parse(decode(opfPath)).package;
    if (!pkg?.manifest || !pkg?.spine) throw new Error("Missing spine");
  } catch { throw new Error("EPUB 结构不完整，找不到书籍目录或阅读顺序。"); }
  const resolve = (base: string, href: string) => {
    const safe = href.split("#")[0].split("?")[0];
    let decoded = safe;
    try { decoded = decodeURIComponent(safe); } catch { /* Keep literal malformed escapes. */ }
    return path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
  };
  const manifest = list<any>(pkg.manifest.item);
  const byId = new Map(manifest.map(item => [item["@_id"], item]));
  const labels = new Map<string, string>();
  const navItem = manifest.find(item => String(item["@_properties"] ?? "").split(/\s+/).includes("nav"));
  if (navItem) {
    const navPath = resolve(opfPath, navItem["@_href"]);
    if (files[navPath]) {
      const doc = parseDocument(decode(navPath));
      for (const a of DomUtils.findAll(n => n.name === "a" && !!n.attribs.href, doc.children)) {
        const key = resolve(navPath, a.attribs.href);
        if (!labels.has(key)) labels.set(key, clean(DomUtils.textContent(a)));
      }
    }
  }
  const ncx = manifest.find(item => item["@_media-type"] === "application/x-dtbncx+xml");
  if (ncx) {
    const ncxPath = resolve(opfPath, ncx["@_href"]);
    if (files[ncxPath]) {
      const visit = (points: any) => list<any>(points).forEach(point => {
        if (point.content?.["@_src"]) {
          const key = resolve(ncxPath, point.content["@_src"]);
          if (!labels.has(key)) labels.set(key, valueText(point.navLabel?.text));
        }
        visit(point.navPoint);
      });
      visit(parser.parse(decode(ncxPath)).ncx?.navMap?.navPoint);
    }
  }
  const chunks: { title: string; text: string }[] = [];
  for (const ref of list<any>(pkg.spine.itemref)) {
    if (ref["@_linear"] === "no") continue;
    const item = byId.get(ref["@_idref"]);
    if (!item) throw new Error("EPUB 阅读顺序引用了缺失的章节。");
    if (!/html/.test(item["@_media-type"] ?? "")) continue;
    const filePath = resolve(opfPath, item["@_href"]);
    const parsed = htmlText(decode(filePath));
    if (parsed.text) chunks.push({ title: labels.get(filePath) || parsed.title || `第 ${chunks.length + 1} 节`, text: parsed.text });
  }
  if (chunks.length === 0) throw new Error("EPUB 中没有可阅读的文字。暂不支持 DRM 加密书籍或纯图片书籍。");
  return assemble(valueText(list(pkg.metadata?.title)[0]) || path.basename(filename, path.extname(filename)), valueText(list(pkg.metadata?.creator)[0]), "EPUB", chunks);
}

function assemble(title: string, author: string, encoding: string, chunks: { title: string; text: string }[]): ParsedBook {
  if (chunks.reduce((sum, chapter) => sum + chapter.text.length, 0) > MAX_TEXT) throw new Error("小说正文超过 3000 万字符，请拆分后导入。");
  const pages: Page[] = [];
  const chapters: ParsedBook["chapters"] = [];
  for (const chunk of chunks) {
    const section = paginate(chunk.title, chunk.text);
    if (section.length) { chapters.push({ title: chunk.title, page: pages.length }); pages.push(...section); }
  }
  return { title, author, encoding, pages, chapters };
}
