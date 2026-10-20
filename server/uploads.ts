import { randomUUID } from "node:crypto";
import type { RpcInput } from "@getpaseo/plugin";
import { startUpload, appendUpload, finishUpload, cancelUpload, UPLOAD_CHUNK_BYTES } from "../shared/library";
import { importBytes } from "./library";

type PendingUpload = RpcInput<typeof startUpload> & {
  chunks: Buffer[];
  received: number;
  touchedAt: number;
};
const pending = new Map<string, PendingUpload>();
const MAX_PENDING_UPLOADS = 2;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function expire() {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, upload] of pending) if (upload.touchedAt < cutoff) pending.delete(id);
}
const expiryTimer = setInterval(expire, 60_000);
expiryTimer.unref();

function get(id: string) {
  expire();
  const upload = pending.get(id);
  if (!upload) throw new Error("上传已取消或过期，请重新选择文件上传。");
  return upload;
}

export function start(input: RpcInput<typeof startUpload>) {
  expire();
  if (pending.size >= MAX_PENDING_UPLOADS) throw new Error("已有两个文件正在上传，请稍后重试。");
  const id = randomUUID().replaceAll("-", "");
  pending.set(id, { ...input, chunks: [], received: 0, touchedAt: Date.now() });
  return { id };
}

export function append({ id, offset, base64 }: RpcInput<typeof appendUpload>) {
  const upload = get(id);
  if (offset !== upload.received) throw new Error("上传顺序不一致，请重新上传。");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > UPLOAD_CHUNK_BYTES || bytes.toString("base64") !== base64) {
    throw new Error("上传内容无效，请重新选择文件。");
  }
  if (upload.received + bytes.length > upload.size) throw new Error("上传内容超过文件声明的大小。");
  upload.chunks.push(bytes);
  upload.received += bytes.length;
  upload.touchedAt = Date.now();
  return { received: upload.received };
}

export async function finish({ id }: RpcInput<typeof finishUpload>) {
  const upload = get(id);
  if (upload.received !== upload.size) throw new Error("文件尚未上传完整，请重新上传。");
  pending.delete(id);
  const bytes = Buffer.concat(upload.chunks, upload.received);
  upload.chunks.length = 0;
  return importBytes(bytes, upload.filename, upload.encoding);
}

export function cancel({ id }: RpcInput<typeof cancelUpload>) {
  pending.delete(id);
  return { ok: true };
}

export function dispose() {
  clearInterval(expiryTimer);
  pending.clear();
}
