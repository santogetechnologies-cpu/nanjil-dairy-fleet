import { useState } from "react";
import { Search } from "lucide-react";

export function DataTable<T>({
  data, columns, searchKeys, pageSize = 10, initialQuery = "",
}: {
  data: T[];
  columns: { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string }[];
  searchKeys?: (keyof T)[];
  pageSize?: number;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  let rows = data;
  if (q && searchKeys?.length) {
    const lower = q.toLowerCase();
    rows = rows.filter((r) =>
      searchKeys.some((k) => String((r as any)[k] ?? "").toLowerCase().includes(lower))
    );
  }
  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const slice = rows.slice((cur - 1) * pageSize, cur * pageSize);

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 h-9 bg-muted rounded-md w-full sm:max-w-xs">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search…"
            className="bg-transparent outline-none text-sm w-full"
          />
        </div>
        <div className="ml-auto text-xs text-muted-foreground">{total} results</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => {
                    if (sortKey === c.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else { setSortKey(c.key); setSortDir("asc"); }
                  }}
                  className={`px-3 py-2 font-medium cursor-pointer select-none ${c.className ?? ""}`}
                >
                  {c.label}
                  {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr key={i} className="border-t border-border hover:bg-muted/30 transition-colors">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.className ?? ""}`}>
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Page {cur} of {pages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={cur === 1}
              className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50"
            >Prev</button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={cur === pages}
              className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
