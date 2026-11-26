import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select option...",
  searchPlaceholder = "Type to search...",
  emptyText = "No matching records",
  disabled = false,
  ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) =>
      `${opt.label} ${opt.sublabel || ""} ${opt.badge || ""}`.toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
            setQuery("");
          }
        }}
        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-left flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          {selectedOption ? (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-bold text-slate-900">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                  {selectedOption.badge}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 font-medium">{placeholder}</span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-40 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent outline-none text-xs text-slate-800"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">{emptyText}</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      isSelected ? "bg-indigo-50/90 text-indigo-900" : "hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{opt.sublabel}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {opt.badge && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
