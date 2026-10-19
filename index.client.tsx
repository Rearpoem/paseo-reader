import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LibraryPanel } from "./client/library";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "library",
    title: "小说",
    icon: "BookOpen",
    context: "workspace",
    locations: ["explorer"],
    Component: LibraryPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "read-novel",
    title: "在侧栏阅读小说",
    icon: "BookOpen",
    keywords: ["小说", "阅读", "TXT", "EPUB"],
    context: "workspace",
    onSelect({ openPanel }) { openPanel("library", { location: "explorer" }); },
  });
  return () => { removeCommand(); removePanel(); };
}
