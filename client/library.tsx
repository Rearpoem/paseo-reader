import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Platform, type TextStyle } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginHostProps, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { listBooks, browseFiles, importBook, startUpload, appendUpload, finishUpload, cancelUpload, MAX_BOOK_BYTES, UPLOAD_CHUNK_BYTES, readPage, savePosition, savePreferences, type Book, type Preferences, type Position, type Encoding } from "../shared/library";
import { supportsFileSelection, selectBookFile, type SelectedBookFile, type FileSelection } from "./web";

type Colors = PluginTheme["colors"];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Request failed:\s*/, "").replace(/\s+requestType=.*$/, "");
const percent = (book: Book) => Math.min(100, Math.round((book.position.page + book.position.offset) / Math.max(book.pageCount, 1) * 100));

function Button({ children, onPress, colors: c, primary = false, disabled = false, label }: { children: ReactNode; onPress: () => void; colors: Colors; primary?: boolean; disabled?: boolean; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, justifyContent: "center", borderRadius: 7,
      backgroundColor: primary ? c.accent : pressed ? c.surface2 : c.surface1, borderWidth: primary ? 0 : 1, borderColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 })}>
    <Text style={{ color: primary ? c.accentForeground : c.foreground, fontSize: 14, fontWeight: "500", textAlign: "center" }}>{children}</Text>
  </Pressable>;
}

function ErrorMessage({ error, colors: c }: { error: unknown; colors: Colors }) {
  if (!error) return null;
  return <View accessibilityRole="alert" style={{ padding: 14, borderWidth: 1, borderColor: c.statusDanger, borderRadius: 6 }}>
    <Text selectable style={{ color: c.statusDanger, fontSize: 14, lineHeight: 22 }}>{message(error)}</Text>
  </View>;
}

function Field({ value, onChangeText, placeholder, colors: c, label, onSubmit }: { value: string; onChangeText: (text: string) => void; placeholder: string; colors: Colors; label: string; onSubmit?: () => void }) {
  return <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.foregroundMuted}
    autoCapitalize="none" autoCorrect={false} onSubmitEditing={onSubmit} style={{ minWidth: 80, minHeight: 42, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: c.border, borderRadius: 7, color: c.foreground, backgroundColor: c.surface0, fontSize: 14, flex: 1 }} />;
}

export function LibraryPanel(props: PluginWorkspacePanelProps) {
  return <Library key={props.host.id} {...props} layout={{ ...props.layout, compact: true }} />;
}

function Library({ theme, host, layout }: PluginHostProps) {
  const c = theme.colors;
  const rpc = useRpc(listBooks);
  const queryClient = useQueryClient();
  const library = useQuery({ queryKey: ["novels", host.id], queryFn: () => rpc({}), refetchOnWindowFocus: true });
  const [reading, setReading] = useState<Book | null>(null);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const spacing = layout.compact ? 16 : 32;
  if (reading && library.data) return <Reader key={reading.id} book={reading} initialPreferences={library.data.preferences} colors={c} compact={layout.compact} onExit={() => { setReading(null); void queryClient.invalidateQueries({ queryKey: ["novels", host.id] }); }} />;
  if (importing) return <Importer colors={c} compact={layout.compact} hostId={host.id} hostLabel={host.label} onClose={() => setImporting(false)} onImported={(book, duplicate) => {
    setImporting(false); setNotice(duplicate ? `《${book.title}》已在书架中，保留了原来的阅读进度。` : `《${book.title}》已加入书架。`); void library.refetch();
  }} />;
  const books = library.data?.books ?? [];
  const visible = books.filter(book => `${book.title} ${book.author} ${book.filename}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const latest = books.find(book => book.lastReadAt > 0);
  return <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: spacing, width: "100%", maxWidth: 1000, alignSelf: "center", gap: 22 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <View style={{ gap: 6, flex: 1 }}><Text style={{ color: c.foreground, fontSize: 27, fontWeight: "600" }}>书架</Text><Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{books.length} 本小说 · 本地阅读</Text></View>
      <Button colors={c} primary onPress={() => { setNotice(""); setImporting(true); }}>导入小说</Button>
    </View>
    <ErrorMessage error={library.error} colors={c} />
    {library.error && <Button colors={c} onPress={() => { void library.refetch(); }}>重新加载书架</Button>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 14 }}>{notice}</Text>}
    {library.isPending && <Text style={{ color: c.foregroundMuted }}>正在打开书架…</Text>}
    {latest && !query && <Pressable accessibilityRole="button" accessibilityLabel={`继续阅读 ${latest.title}`} onPress={() => setReading(latest)}
      style={({ pressed }) => ({ flexDirection: "row", gap: 18, padding: 22, borderRadius: 8, backgroundColor: pressed ? c.surface2 : c.surface1, borderLeftWidth: 4, borderLeftColor: c.accent })}>
      <View style={{ flex: 1, gap: 9 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>接着上次读</Text>
        <Text style={{ color: c.foreground, fontSize: 22, fontFamily: Platform.OS === "android" ? "serif" : "Songti SC" }}>{latest.title}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>第 {latest.position.page + 1} / {latest.pageCount} 页 · {percent(latest)}%</Text></View>
      <Text style={{ color: c.accent, fontSize: 24, alignSelf: "center" }}>→</Text>
    </Pressable>}
    {books.length > 0 && <View style={{ flexDirection: "row" }}><Field value={query} onChangeText={setQuery} placeholder="搜索书名或作者" label="搜索书架" colors={c} /></View>}
    {!library.isPending && !library.error && books.length === 0 && <View style={{ paddingVertical: 60, gap: 16, alignItems: "center" }}>
      <Text style={{ color: c.foreground, fontFamily: Platform.OS === "android" ? "serif" : "Songti SC", fontSize: layout.compact ? 24 : 30, textAlign: "center" }}>留一会儿时间，读几页书。</Text>
      <Text style={{ color: c.foregroundMuted, textAlign: "center", fontSize: 15, lineHeight: 26 }}>导入你的 TXT 或 EPUB 小说。{"\n"}章节与阅读位置会自动保存。</Text>
      <Button colors={c} onPress={() => setImporting(true)}>选择第一本小说</Button>
    </View>}
    {query && visible.length === 0 && <Text style={{ color: c.foregroundMuted }}>没有匹配的小说，试试其他书名或作者。</Text>}
    {visible.map(book => <Pressable key={book.id} accessibilityRole="button" accessibilityLabel={`阅读 ${book.title}`} onPress={() => setReading(book)}
      style={({ pressed }) => ({ flexDirection: "row", gap: 18, paddingVertical: 19, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surface1 : c.surface0 })}>
      <View style={{ width: 44, minHeight: 62, borderLeftWidth: 3, borderLeftColor: c.accent, backgroundColor: c.surface1, justifyContent: "center", alignItems: "center", borderRadius: 3 }}><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{book.format}</Text></View>
      <View style={{ flex: 1, gap: 7 }}><Text style={{ color: c.foreground, fontSize: 18, fontWeight: "500" }}>{book.title}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{book.author ? `${book.author} · ` : ""}{book.chapterCount} 章 · {book.pageCount} 页</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{book.lastReadAt ? `读至 ${percent(book)}%` : "未开始"}{book.format === "TXT" ? ` · ${book.encoding}` : ""}</Text></View>
      <Text style={{ color: c.foregroundMuted, fontSize: 20, alignSelf: "center" }}>›</Text>
    </Pressable>)}
    <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 20 }}>小说保存在这台主机上。只读取文字，不调用 AI，也不上传到第三方。</Text>
  </ScrollView>;
}

function FileUploader({ colors: c, encoding, hostLabel, onBusy, onImported }: { colors: Colors; encoding: Encoding; hostLabel: string; onBusy: (busy: boolean) => void; onImported: (book: Book, duplicate: boolean) => void }) {
  const begin = useRpc(startUpload);
  const append = useRpc(appendUpload);
  const finish = useRpc(finishUpload);
  const cancel = useRpc(cancelUpload);
  const [file, setFile] = useState<SelectedBookFile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "uploading" | "finishing" | "cancelling">("idle");
  const [notice, setNotice] = useState("");
  const selection = useRef<FileSelection | null>(null);
  const active = useRef<{ cancelled: boolean; finishing?: boolean; id?: string } | null>(null);
  const mounted = useRef(true);
  const cancelRpc = useRef(cancel);
  cancelRpc.current = cancel;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current?.cancel();
      if (active.current) {
        active.current.cancelled = true;
        if (active.current.id) void cancelRpc.current({ id: active.current.id }).catch(() => {});
      }
    };
  }, []);
  const upload = useMutation({
    mutationFn: async ({ selected, encoding: selectedEncoding }: { selected: SelectedBookFile; encoding: Encoding }) => {
      const run: { cancelled: boolean; finishing?: boolean; id?: string } = { cancelled: false };
      active.current = run;
      setProgress(0); setPhase("uploading"); setError(null); setNotice("");
      try {
        const started = await begin({ filename: selected.name, size: selected.size, encoding: selectedEncoding });
        run.id = started.id;
        for (let offset = 0; offset < selected.size; offset += UPLOAD_CHUNK_BYTES) {
          if (run.cancelled) return null;
          const base64 = await selected.readChunk(offset, UPLOAD_CHUNK_BYTES);
          if (run.cancelled) return null;
          const result = await append({ id: run.id, offset, base64 });
          if (mounted.current) setProgress(Math.round(result.received / selected.size * 100));
        }
        if (run.cancelled) return null;
        run.finishing = true;
        if (mounted.current) setPhase("finishing");
        return await finish({ id: run.id });
      } catch (err) {
        if (run.cancelled) return null;
        throw err;
      } finally {
        if (run.id) void cancelRpc.current({ id: run.id }).catch(() => {});
        if (active.current === run) active.current = null;
      }
    },
    onSuccess: result => { if (mounted.current && result) onImported(result.book, result.duplicate); },
    onError: err => { if (mounted.current) setError(err); },
    onSettled: () => { if (mounted.current) { setPhase("idle"); onBusy(false); } },
  });
  const choose = async () => {
    setError(null); setNotice(""); setPicking(true); onBusy(true);
    try {
      const picker = selectBookFile();
      selection.current = picker;
      const selected = await picker.result;
      if (!mounted.current || !selected) return;
      setFile(null);
      if (!/^[^/\\\x00-\x1f]+\.(txt|epub)$/i.test(selected.name) || selected.name.length > 255) throw new Error("请选择 TXT 或 EPUB 小说文件，文件名需在 255 个字符以内。");
      if (selected.size > MAX_BOOK_BYTES) throw new Error("单本文件上限为 50 MB，请拆分后上传。");
      if (!selected.size) throw new Error("这个文件是空的，请选择有正文的 TXT 或 EPUB。");
      setFile(selected);
    } catch (err) { if (mounted.current) setError(err); }
    finally { selection.current = null; if (mounted.current) { setPicking(false); onBusy(false); } }
  };
  const stop = () => {
    const run = active.current;
    if (!run || run.finishing) return;
    run.cancelled = true;
    setPhase("cancelling"); setNotice("已取消上传，文件未加入书架。");
    if (run.id) void cancel({ id: run.id }).catch(() => {});
  };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 21 }}>从当前设备选择文件，上传到 {hostLabel} 的书架。支持 TXT / EPUB，单本上限 50 MB。</Text>
    <Button colors={c} disabled={upload.isPending || picking} onPress={() => { void choose(); }}>{picking ? "等待选择文件…" : file ? "重新选择文件" : "选择文件"}</Button>
    {picking && <Button colors={c} onPress={() => selection.current?.cancel()}>取消选择</Button>}
    {file && <View style={{ padding: 14, gap: 7, backgroundColor: c.surface1, borderRadius: 7 }}>
      <Text selectable style={{ color: c.foreground, fontSize: 15 }}>{file.name}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}</Text>
    </View>}
    <Button colors={c} primary disabled={!file || picking || upload.isPending} onPress={() => { if (file) { onBusy(true); upload.mutate({ selected: file, encoding }); } }}>
      {phase === "finishing" ? "正在解析并加入书架…" : phase === "cancelling" ? "正在取消…" : upload.isPending ? `正在上传 ${progress}%` : "上传到书架"}
    </Button>
    {upload.isPending && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} accessibilityLabel="小说上传进度" style={{ height: 5, backgroundColor: c.surface2, borderRadius: 3, overflow: "hidden" }}>
      <View style={{ height: 5, width: `${progress}%`, backgroundColor: c.accent }} />
    </View>}
    {phase === "uploading" && <Button colors={c} onPress={stop}>取消上传</Button>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 13 }}>{notice}</Text>}
    <ErrorMessage error={error} colors={c} />
    {!!error && file && <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 20 }}>未完成的上传不会加入书架。可以重新选择文件，或点击“上传到书架”重试。</Text>}
  </View>;
}

function Importer({ colors: c, compact, hostId, hostLabel, onClose, onImported }: { colors: Colors; compact: boolean; hostId: string; hostLabel: string; onClose: () => void; onImported: (book: Book, duplicate: boolean) => void }) {
  const browse = useRpc(browseFiles);
  const importFile = useRpc(importBook);
  const [folder, setFolder] = useState("~/Downloads");
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const canUpload = supportsFileSelection();
  const [mode, setMode] = useState<"upload" | "host">(canUpload ? "upload" : "host");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [encoding, setEncoding] = useState<Encoding>("auto");
  const listing = useQuery({ queryKey: ["novel-files", hostId, folder, filter], queryFn: () => browse({ path: folder, query: filter }), retry: false, enabled: mode === "host" });
  const importing = useMutation({ mutationFn: () => importFile({ path: input.trim(), encoding }), onSuccess: result => onImported(result.book, result.duplicate) });
  const busy = uploadBusy || importing.isPending;
  const changeFolder = (path: string) => { setFolder(path); setFilter(""); importing.reset(); };
  return <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: compact ? 16 : 28, gap: 15 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}><Button colors={c} disabled={busy} onPress={onClose}>返回书架</Button><Text style={{ color: c.foreground, fontSize: 23, fontWeight: "600" }}>导入小说</Text></View>
    {canUpload ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button colors={c} primary={mode === "upload"} disabled={busy} onPress={() => setMode("upload")}>上传文件</Button>
      <Button colors={c} primary={mode === "host"} disabled={busy} onPress={() => setMode("host")}>主机文件</Button>
    </View> : <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 21 }}>此客户端可导入主机文件；从设备选择文件上传，请使用 Paseo 桌面端或浏览器。</Text>}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }}><Text style={{ color: c.foregroundMuted, fontSize: 13 }}>TXT 编码</Text>
      {([['auto','自动'],['utf-8','UTF-8'],['gb18030','GB18030'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE']] as const).map(([value, title]) => <Button key={value} colors={c} primary={encoding === value} disabled={busy} onPress={() => setEncoding(value)}>{title}</Button>)}
    </View>
    {mode === "upload" ? <FileUploader colors={c} encoding={encoding} hostLabel={hostLabel} onBusy={setUploadBusy} onImported={onImported} /> : <>
    <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 21 }}>选择 {hostLabel} 上的 TXT / EPUB 文件，或直接粘贴完整路径。单本上限 50 MB。</Text>
    <View style={{ flexDirection: compact ? "column" : "row", gap: 8 }}>
      <Field value={input} onChangeText={setInput} placeholder="例如 /Users/你的用户名/Downloads/小说.epub" label="小说文件路径" colors={c} onSubmit={() => { if (input.trim() && !importing.isPending) importing.mutate(); }} />
      <Button colors={c} primary disabled={!input.trim() || importing.isPending} onPress={() => importing.mutate()}>{importing.isPending ? "正在导入…" : "导入到书架"}</Button>
    </View>
    <ErrorMessage error={importing.error} colors={c} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {([['~','个人文件夹'],['~/Downloads','下载'],['~/Desktop','桌面'],['~/Documents','文稿']] as const).map(([path, label]) => <Button key={path} colors={c} onPress={() => changeFolder(path)}>{label}</Button>)}
      <Button colors={c} disabled={!listing.data || listing.data.path === listing.data.parent} onPress={() => { if (listing.data) changeFolder(listing.data.parent); }}>上一级</Button>
    </View>
    <Text selectable numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 12 }}>{listing.data?.path ?? folder}</Text>
    <View style={{ flexDirection: "row" }}><Field colors={c} label="筛选文件" value={filter} onChangeText={setFilter} placeholder="筛选当前文件夹中的名称" /><View style={{ width: 8 }} /><Button colors={c} onPress={() => { void listing.refetch(); }}>刷新</Button></View>
    <ErrorMessage error={listing.error} colors={c} />
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingBottom: 24 }}>
      {listing.isPending && <Text style={{ color: c.foregroundMuted, padding: 16 }}>正在读取文件夹…</Text>}
      {listing.data?.entries.length === 0 && <Text style={{ color: c.foregroundMuted, padding: 16 }}>这里没有匹配的文件夹或 TXT / EPUB 文件。</Text>}
      {listing.data?.entries.map(entry => <Pressable key={entry.path} accessibilityRole="button" accessibilityLabel={`${entry.directory ? "打开文件夹" : "选择小说"} ${entry.name}`} disabled={importing.isPending}
        onPress={() => { if (entry.directory) changeFolder(entry.path); else { setInput(entry.path); importing.reset(); } }}
        style={({ pressed }) => ({ flexDirection: "row", gap: 14, paddingVertical: 14, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: c.border, backgroundColor: input === entry.path || pressed ? c.surface2 : c.surface0 })}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12, width: 38 }}>{entry.directory ? "目录" : entry.name.toLowerCase().endsWith(".epub") ? "EPUB" : "TXT"}</Text>
        <Text style={{ color: c.foreground, fontSize: 14, flex: 1 }}>{entry.name}</Text><Text style={{ color: c.foregroundMuted }}>{entry.directory ? "›" : input === entry.path ? "已选择" : ""}</Text>
      </Pressable>)}
      {listing.data?.truncated && <Text style={{ color: c.foregroundMuted, padding: 16 }}>只显示前 500 项，请输入名称缩小范围。</Text>}
    </View>
    </>}
  </ScrollView>;
}

function Reader({ book, initialPreferences, colors: c, compact, onExit }: { book: Book; initialPreferences: Preferences; colors: Colors; compact: boolean; onExit: () => void }) {
  const getPage = useRpc(readPage);
  const save = useRpc(savePosition);
  const savePrefs = useRpc(savePreferences);
  const [page, setPage] = useState(book.position.page);
  const [prefs, setPrefs] = useState(initialPreferences);
  const [toc, setToc] = useState(false);
  const [settings, setSettings] = useState(false);
  const [chapterFilter, setChapterFilter] = useState("");
  const [jump, setJump] = useState("");
  const [saveState, setSaveState] = useState("进度已保存");
  const [error, setError] = useState<unknown>(null);
  const position = useRef<Position>({ ...book.position });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroll = useRef<ScrollView>(null);
  const geometry = useRef({ content: 0, viewport: 0, ready: false });
  const saver = useRef(save);
  saver.current = save;
  const mounted = useRef(true);
  const revision = useRef(0);
  const pageData = useQuery({ queryKey: ["novel-page", book.id, page], queryFn: () => getPage({ id: book.id, page }), retry: false });
  const persist = async () => {
    clearTimeout(timer.current);
    const current = ++revision.current;
    const snapshot = { ...position.current };
    setSaveState("正在保存…");
    try { await saver.current({ id: book.id, position: snapshot }); if (mounted.current && current === revision.current) setSaveState("进度已保存"); }
    catch (err) { if (mounted.current && current === revision.current) { setSaveState("进度保存失败"); setError(err); } }
  };
  useEffect(() => {
    mounted.current = true;
    void persist();
    return () => { mounted.current = false; clearTimeout(timer.current); void saver.current({ id: book.id, position: { ...position.current } }).catch(() => {}); };
  }, []);
  const go = (next: number) => {
    if (next < 0 || next >= book.pageCount || !Number.isInteger(next)) return;
    if (next === page) { position.current.offset = 0; scroll.current?.scrollTo({ y: 0, animated: false }); setToc(false); setError(null); void persist(); return; }
    clearTimeout(timer.current);
    position.current = { page: next, offset: 0 };
    geometry.current = { content: 0, viewport: 0, ready: false };
    setPage(next); setToc(false); setError(null); void persist();
  };
  const restore = () => {
    const { content, viewport } = geometry.current;
    if (content > 0 && viewport > 0) {
      scroll.current?.scrollTo({ y: Math.max(0, content - viewport) * position.current.offset, animated: false });
      geometry.current.ready = true;
    }
  };
  const updatePrefs = async (next: Preferences) => {
    const previous = prefs;
    setPrefs(next); setError(null);
    try { await savePrefs(next); }
    catch (err) { setPrefs(previous); setError(err); }
  };
  const progress = Math.min(100, Math.round((page + position.current.offset) / book.pageCount * 100));
  const bodyStyle: TextStyle = { color: c.foreground, fontSize: prefs.fontSize, lineHeight: prefs.fontSize * prefs.lineHeight,
    fontFamily: prefs.serif ? Platform.OS === "android" ? "serif" : "Songti SC" : undefined };
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, padding: compact ? 12 : 18, borderBottomWidth: 1, borderColor: c.border }}>
      <Button colors={c} onPress={() => { void persist().then(onExit); }}>书架</Button>
      <View style={{ flex: 1, minWidth: compact ? 80 : 140, gap: 4 }}><Text numberOfLines={1} style={{ color: c.foreground, fontSize: 16, fontWeight: "600" }}>{book.title}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{saveState}</Text></View>
      <Button colors={c} primary={toc} onPress={() => setToc(!toc)}>目录</Button><Button colors={c} primary={settings} onPress={() => setSettings(!settings)}>排版</Button>
    </View>
    {settings && <View style={{ padding: 14, gap: 12, borderBottomWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>字号 {prefs.fontSize}</Text><Button colors={c} label="缩小字号" disabled={prefs.fontSize <= 16} onPress={() => { void updatePrefs({ ...prefs, fontSize: prefs.fontSize - 2 }); }}>A−</Button><Button colors={c} label="放大字号" disabled={prefs.fontSize >= 32} onPress={() => { void updatePrefs({ ...prefs, fontSize: prefs.fontSize + 2 }); }}>A＋</Button>
      <Button colors={c} primary={prefs.serif} onPress={() => { void updatePrefs({ ...prefs, serif: !prefs.serif }); }}>{prefs.serif ? "宋体" : "系统字体"}</Button>
      <Button colors={c} onPress={() => { void updatePrefs({ ...prefs, lineHeight: prefs.lineHeight === 1.9 ? 2.2 : prefs.lineHeight === 2.2 ? 1.6 : 1.9 }); }}>行距 {prefs.lineHeight}</Button>
    </View>}
    {!!error && <View style={{ padding: 12 }}><ErrorMessage error={error} colors={c} /><Button colors={c} onPress={() => { setError(null); if (saveState === "进度保存失败") void persist(); }}>{saveState === "进度保存失败" ? "重试保存进度" : "关闭提示"}</Button></View>}
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
      {toc && <View style={{ width: compact ? "100%" : 260, borderRightWidth: compact ? 0 : 1, borderColor: c.border, padding: 14, gap: 12 }}>
        <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "600" }}>章节目录</Text><View style={{ flexDirection: "row" }}><Field colors={c} label="搜索章节" placeholder="搜索章节" value={chapterFilter} onChangeText={setChapterFilter} /></View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 4 }}>
          {pageData.data?.chapters.filter(chapter => chapter.title.toLowerCase().includes(chapterFilter.toLowerCase())).map(chapter => <Pressable key={chapter.page} accessibilityRole="button" accessibilityLabel={`跳转章节 ${chapter.title}`} onPress={() => { go(chapter.page); setToc(false); }}
            style={({ pressed }) => ({ padding: 12, gap: 5, borderRadius: 5, backgroundColor: pressed || page >= chapter.page && page < (pageData.data!.chapters.find(next => next.page > chapter.page)?.page ?? book.pageCount) ? c.surface2 : c.surface0 })}>
            <Text style={{ color: c.foreground, fontSize: 14, lineHeight: 22 }}>{chapter.title}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>第 {chapter.page + 1} 页</Text>
          </Pressable>)}
        </ScrollView>
      </View>}
      {!(compact && toc) && <View style={{ flex: 1, minWidth: 0 }}>
        {pageData.isPending && <Text style={{ color: c.foregroundMuted, padding: 28 }}>正在打开正文…</Text>}
        {!!pageData.error && <View style={{ padding: 24, gap: 12 }}><ErrorMessage error={pageData.error} colors={c} /><Button colors={c} onPress={() => { void pageData.refetch(); }}>重新加载正文</Button></View>}
        {pageData.data && <ScrollView key={page} ref={scroll} style={{ flex: 1 }} scrollEventThrottle={120}
          onLayout={event => { geometry.current.viewport = event.nativeEvent.layout.height; restore(); }}
          onContentSizeChange={(_, height) => { geometry.current.content = height; restore(); }}
          onScroll={event => {
            if (!geometry.current.ready) return;
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const range = contentSize.height - layoutMeasurement.height;
            const offset = range > 0 ? Math.max(0, Math.min(1, contentOffset.y / range)) : position.current.offset;
            position.current = { page, offset }; setSaveState("正在保存…"); clearTimeout(timer.current); timer.current = setTimeout(() => { void persist(); }, 650);
          }} contentContainerStyle={{ paddingHorizontal: compact ? 22 : 48, paddingTop: 35, paddingBottom: 70, width: "100%", maxWidth: 850, alignSelf: "center" }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, marginBottom: 18 }}>第 {page + 1} 页 / 共 {book.pageCount} 页</Text>
          <Text style={{ ...bodyStyle, fontSize: prefs.fontSize + 6, lineHeight: (prefs.fontSize + 6) * 1.5, fontWeight: "600", marginBottom: 30 }}>{pageData.data.title}</Text>
          <Text selectable style={bodyStyle}>{book.format === "EPUB" && pageData.data.text.startsWith(pageData.data.title + "\n") ? pageData.data.text.slice(pageData.data.title.length).trimStart() : pageData.data.text}</Text>
          <View style={{ alignItems: "center", marginTop: 42 }}><Button colors={c} onPress={() => { if (page === book.pageCount - 1) { position.current.offset = 1; void persist(); } else go(page + 1); }}>{page === book.pageCount - 1 ? "全书读完 · 保存进度" : "继续下一页 →"}</Button></View>
        </ScrollView>}
      </View>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: compact ? 12 : 16, borderTopWidth: 1, borderColor: c.border }}>
      <Button colors={c} disabled={page <= 0 || pageData.isPending} onPress={() => go(page - 1)}>上一页</Button>
      <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{page + 1} / {book.pageCount} · {progress}%</Text>
        {!compact && <><TextInput accessibilityLabel="跳转页码" keyboardType="number-pad" placeholder="页码" placeholderTextColor={c.foregroundMuted} value={jump} onChangeText={setJump}
          onSubmitEditing={() => { const n = Number(jump); if (Number.isInteger(n) && n >= 1 && n <= book.pageCount) { go(n - 1); setJump(""); } else setError(new Error(`请输入 1 到 ${book.pageCount} 之间的页码。`)); }}
          style={{ width: 58, padding: 8, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 5 }} />
          <Button colors={c} onPress={() => { const n = Number(jump); if (Number.isInteger(n) && n >= 1 && n <= book.pageCount) { go(n - 1); setJump(""); } else setError(new Error(`请输入 1 到 ${book.pageCount} 之间的页码。`)); }}>跳转</Button></>}
      </View>
      <Button colors={c} disabled={page >= book.pageCount - 1 || pageData.isPending} onPress={() => go(page + 1)}>下一页</Button>
    </View>
  </View>;
}
