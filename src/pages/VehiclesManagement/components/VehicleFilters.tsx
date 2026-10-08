import { 
  Search, 
  Filter, 
  ArrowUpDown, 
  RotateCcw, 
  LayoutGrid, 
  List, 
  X,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui-kit";
import type { VehicleFiltersState, MaintenanceHealthStatus } from "../types";
import type { VehicleStatus } from "@/lib/types";

interface VehicleFiltersProps {
  filters: VehicleFiltersState;
  onChange: (filters: VehicleFiltersState) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  vehicleTypes: string[];
  drivers: string[];
  totalVehicles: number;
  filteredCount: number;
}

export function VehicleFilters({
  filters,
  onChange,
  onRefresh,
  isRefreshing = false,
  vehicleTypes,
  drivers,
  totalVehicles,
  filteredCount,
}: VehicleFiltersProps) {
  const hasActiveFilters = 
    filters.searchQuery.trim() !== "" ||
    filters.status !== "All" ||
    filters.vehicleType !== "All" ||
    filters.driver !== "All" ||
    filters.maintenanceStatus !== "All";

  const handleReset = () => {
    onChange({
      ...filters,
      searchQuery: "",
      status: "All",
      vehicleType: "All",
      driver: "All",
      maintenanceStatus: "All",
      sortBy: "number",
      sortOrder: "asc",
    });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-3.5">
      {/* Top Search & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by Vehicle Number, Name, or Device ID..."
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            className="w-full pl-9 pr-9 h-10 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {filters.searchQuery && (
            <button
              onClick={() => onChange({ ...filters, searchQuery: "" })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* View Toggle & Refresh & Reset */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="h-10 text-xs text-muted-foreground hover:text-destructive gap-1 px-2.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}

          {/* Grid / List View Toggle */}
          <div className="flex items-center border border-border rounded-lg p-0.5 bg-muted/40">
            <button
              onClick={() => onChange({ ...filters, viewMode: "grid" })}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                filters.viewMode === "grid"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Grid View"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => onChange({ ...filters, viewMode: "list" })}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                filters.viewMode === "list"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="List View"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-10 text-xs gap-1.5 px-3"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filter Dropdowns Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
        {/* Status Filter */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Status
          </label>
          <select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value as VehicleStatus | "All" })}
            className="w-full h-9 px-2.5 border border-border rounded-lg bg-background text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Moving">Moving</option>
            <option value="Idle">Idle</option>
            <option value="Parked">Parked</option>
            <option value="Offline">Offline</option>
            <option value="Maintenance">Maintenance</option>
          </select>
        </div>

        {/* Vehicle Type Filter */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Type
          </label>
          <select
            value={filters.vehicleType}
            onChange={(e) => onChange({ ...filters, vehicleType: e.target.value })}
            className="w-full h-9 px-2.5 border border-border rounded-lg bg-background text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer truncate"
          >
            <option value="All">All Types ({vehicleTypes.length})</option>
            {vehicleTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Driver Filter */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Driver
          </label>
          <select
            value={filters.driver}
            onChange={(e) => onChange({ ...filters, driver: e.target.value })}
            className="w-full h-9 px-2.5 border border-border rounded-lg bg-background text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer truncate"
          >
            <option value="All">All Drivers ({drivers.length})</option>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Maintenance Status Filter */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Maintenance
          </label>
          <select
            value={filters.maintenanceStatus}
            onChange={(e) => onChange({ ...filters, maintenanceStatus: e.target.value as MaintenanceHealthStatus | "All" })}
            className="w-full h-9 px-2.5 border border-border rounded-lg bg-background text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
          >
            <option value="All">All Maintenance</option>
            <option value="Good">Good</option>
            <option value="Due Soon">Due Soon</option>
            <option value="Due">Due</option>
            <option value="Overdue">Overdue</option>
            <option value="Under Maintenance">Under Maintenance</option>
          </select>
        </div>

        {/* Sort By Filter */}
        <div className="col-span-2 sm:col-span-1">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Sort By
          </label>
          <div className="flex items-center gap-1.5">
            <select
              value={filters.sortBy}
              onChange={(e) => onChange({ ...filters, sortBy: e.target.value as any })}
              className="flex-1 h-9 px-2.5 border border-border rounded-lg bg-background text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
            >
              <option value="number">Vehicle Number</option>
              <option value="topSpeed">Top Speed</option>
              <option value="avgSpeed">Average Speed</option>
              <option value="avgMileage">Average Mileage</option>
              <option value="maintenance">Maintenance</option>
              <option value="lastUpdate">Last Updated</option>
              <option value="status">Status</option>
            </select>
            <button
              onClick={() => onChange({ ...filters, sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" })}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title={`Sorting ${filters.sortOrder === "asc" ? "Ascending" : "Descending"}`}
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Result Count Status Bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
        <div>
          Showing <span className="font-semibold text-foreground">{filteredCount}</span> of{" "}
          <span className="font-semibold text-foreground">{totalVehicles}</span> vehicles
        </div>
        {hasActiveFilters && (
          <span className="text-[11px] text-primary font-medium">
            Active filters applied
          </span>
        )}
      </div>
    </div>
  );
}
