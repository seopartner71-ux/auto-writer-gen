// P22 - interactive SILO map. Reads page_registry data via the Performance
// Center payload, nothing is mutated here.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { SiloNode } from "./types";

const DOT: Record<SiloNode["status"], string> = {
  PASS: "bg-green-500",
  REVIEW: "bg-yellow-500",
  FAIL: "bg-destructive",
};

export function SiloMap({
  nodes, ru, siteUrl, onOpenPage,
}: {
  nodes: SiloNode[];
  ru: boolean;
  siteUrl: string | null;
  onOpenPage: (node: SiloNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"all" | SiloNode["status"]>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) =>
      (status === "all" || n.status === status)
      && (!q || n.url_path.toLowerCase().includes(q) || n.title.toLowerCase().includes(q)));
  }, [nodes, query, status]);

  const children = useMemo(() => {
    const map = new Map<string, SiloNode[]>();
    const ids = new Set(filtered.map((n) => n.id));
    for (const n of filtered) {
      const key = n.parent && ids.has(n.parent) ? n.parent : "root";
      map.set(key, [...(map.get(key) || []), n]);
    }
    for (const list of map.values()) list.sort((a, b) => a.url_path.localeCompare(b.url_path));
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c = { PASS: 0, REVIEW: 0, FAIL: 0 };
    for (const n of nodes) c[n.status]++;
    return c;
  }, [nodes]);

  const renderNode = (node: SiloNode, depth: number) => {
    const kids = children.get(node.id) || [];
    const expanded = open[node.id] ?? depth < 1;
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1"
          style={{ paddingLeft: depth * 16 + 4 }}
        >
          {kids.length > 0 ? (
            <button type="button" onClick={() => setOpen((s) => ({ ...s, [node.id]: !expanded }))}>
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-3.5" />}
          <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[node.status]}`} />
          <button
            type="button"
            className="truncate text-left hover:text-primary"
            onClick={() => onOpenPage(node)}
            title={node.title}
          >
            {node.url_path}
          </button>
          <Badge variant="outline" className="text-[10px] px-1 py-0">{node.page_type}</Badge>
          {node.indexed && <Badge variant="outline" className="text-[10px] px-1 py-0 text-green-500">index</Badge>}
          {siteUrl && (
            <a href={`${siteUrl.replace(/\/$/, "")}${node.url_path}`} target="_blank" rel="noreferrer"
              className="ml-auto text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {expanded && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={ru ? "Поиск по URL" : "Search by URL"} className="h-8 w-56" />
        {(["all", "PASS", "REVIEW", "FAIL"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)}
            className={`px-2 py-1 rounded text-xs border ${status === s ? "border-primary text-primary" : "border-border/60 text-muted-foreground"}`}>
            {s === "all" ? (ru ? "Все" : "All") : s}
            {s !== "all" && ` ${counts[s]}`}
          </button>
        ))}
      </div>
      <div className="max-h-[420px] overflow-auto rounded border border-border/60 p-2">
        {(children.get("root") || []).map((n) => renderNode(n, 0))}
        {!filtered.length && (
          <p className="text-xs text-muted-foreground p-2">{ru ? "Ничего не найдено." : "Nothing found."}</p>
        )}
      </div>
    </div>
  );
}
