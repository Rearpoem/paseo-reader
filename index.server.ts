import type { PluginServerContext } from "@getpaseo/plugin/server";
import * as library from "./server/library";
import * as uploads from "./server/uploads";
import { listBooks, browseFiles, importBook, startUpload, appendUpload, finishUpload, cancelUpload, readPage, savePosition, savePreferences } from "./shared/library";

export default function contribute(server: PluginServerContext) {
  server.handle(listBooks, library.list);
  server.handle(browseFiles, library.browse);
  server.handle(importBook, library.importFile);
  server.handle(startUpload, uploads.start);
  server.handle(appendUpload, uploads.append);
  server.handle(finishUpload, uploads.finish);
  server.handle(cancelUpload, uploads.cancel);
  server.handle(readPage, library.page);
  server.handle(savePosition, library.position);
  server.handle(savePreferences, library.preferences);
  return uploads.dispose;
}
