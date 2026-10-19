import type { PluginServerContext } from "@getpaseo/plugin/server";
import * as library from "./server/library";
import { listBooks, browseFiles, importBook, readPage, savePosition, savePreferences } from "./shared/library";

export default function contribute(server: PluginServerContext) {
  server.handle(listBooks, library.list);
  server.handle(browseFiles, library.browse);
  server.handle(importBook, library.importFile);
  server.handle(readPage, library.page);
  server.handle(savePosition, library.position);
  server.handle(savePreferences, library.preferences);
  return () => {};
}
