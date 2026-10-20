import { Platform } from "react-native";

// Browser APIs stay in this adapter; native clients never access the document.
interface BrowserFile {
  name: string;
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
interface FileInput {
  type: string;
  accept: string;
  multiple: boolean;
  style: { display: string };
  files: ArrayLike<BrowserFile> | null;
  addEventListener(name: string, listener: () => void): void;
  remove(): void;
  click(): void;
}
interface BrowserApi {
  document?: { createElement(tag: "input"): FileInput; body: { appendChild(input: FileInput): void } };
  btoa(value: string): string;
}
const browser = () => globalThis as unknown as BrowserApi;

export interface SelectedBookFile {
  name: string;
  size: number;
  readChunk(offset: number, length: number): Promise<string>;
}
export interface FileSelection {
  result: Promise<SelectedBookFile | null>;
  cancel(): void;
}

export function supportsFileSelection() {
  return Platform.OS === "web" && !!browser().document;
}

export function selectBookFile(): FileSelection {
  const document = Platform.OS === "web" ? browser().document : undefined;
  if (!document) throw new Error("请在 Paseo 桌面端或浏览器中选择文件上传。");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.epub,text/plain,application/epub+zip";
  input.multiple = false;
  input.style.display = "none";
  let settle: (value: SelectedBookFile | null) => void;
  const result = new Promise<SelectedBookFile | null>(resolve => { settle = resolve; });
  let completed = false;
  const finish = (file: BrowserFile | null) => {
    if (completed) return;
    completed = true;
    input.remove();
    settle(file ? {
      name: file.name, size: file.size,
      async readChunk(offset, length) {
        const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
        const parts: string[] = [];
        for (let index = 0; index < bytes.length; index += 8192) {
          parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
        }
        return browser().btoa(parts.join(""));
      },
    } : null);
  };
  input.addEventListener("change", () => finish(input.files?.[0] ?? null));
  input.addEventListener("cancel", () => finish(null));
  document.body.appendChild(input);
  try { input.click(); }
  catch (error) { finish(null); throw error; }
  return { result, cancel: () => finish(null) };
}
