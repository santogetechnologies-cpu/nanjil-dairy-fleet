import { useState } from "react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip 
} from "recharts";
import { Card, CardHeader } from "@/components/ui-kit";
import { TrendingUp, Activity, Fuel, Route, Wrench } from "lucide-react";

interface SpeedPoint {
  t: string;
  speed: number;
}

interface FuelPoint {
  date: string;
  liters: number;
  cost: number;
  mileage: number | null;
}

interface TripPoint {
  date: string;
  distance: number;
}

interface MaintenanceCostPoint {
  date: string;
  cost: number;
  service: string;
}

interface VehicleChartsProps {
  speedData: SpeedPoint[];
  fuelData: FuelPoint[];
  tripData: TripPoint[];
  maintenanceCostData: MaintenanceCostPoint[];
}

export function VehicleCharts({
  speedData,
  fuelData,
  tripData,
  maintenanceCostData,
}: VehicleChartsProps) {
  const [activeTab, setActiveTab] = useState<"speed" | "fuel" | "trips" | "maintenance">("speed");

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Performance & Operational Analytics Trends
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Visual trends plotted from verified backend telemetry, fuel, and trip records
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1 p-1 bg-muted/60 border border-border rounded-xl self-start sm:self-auto overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab("speed")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "speed"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Speed Trend
          </button>
          <button
            onClick={() => setActiveTab("fuel")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "fuel"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Fuel & Refills
          </button>
          <button
            onClick={() => setActiveTab("trips")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "trips"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Trip Distance
          </button>
          <button
            onClick={() => setActiveTab("maintenance")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "maintenance"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Maintenance Cost
          </button>
        </div>
      </div>

      <div className="p-5">
        {/* TAB 1: Speed Trend */}
        {activeTab === "speed" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Telemetry Speed Velocity (km/h)
              </span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Telemetry Feed
                </span>
                <span className="text-xs text-muted-foreground">
                  {speedData.length} telemetry points
                </span>
              </div>
            </div>

            {speedData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-xs text-muted-foreground">
                <Activity className="h-8 w-8 text-muted-foreground/30 mb-2" />
                No speed telemetry records in this period
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={speedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.38 0.20 264)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="oklch(0.38 0.20 264)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.90 0.012 240 / 0.5)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={25} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        borderColor: "var(--color-border)",
                        borderRadius: "0.5rem",
                        fontSize: "12px",
                      }}
                      formatter={(val: any) => [`${val} km/h`, "Speed"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="speed"
                      stroke="oklch(0.38 0.20 264)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#speedGrad)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Fuel Consumption & Refills */}
        {activeTab === "fuel" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5 text-emerald-500" />
                Fuel Refill Purchases (Liters & Cost)
              </span>
              <span className="text-xs text-muted-foreground">
                {fuelData.length} refill events
              </span>
            </div>

            {fuelData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-xs text-muted-foreground">
                <Fuel className="h-8 w-8 text-muted-foreground/30 mb-2" />
                No fuel refill records in this period
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fuelData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.90 0.012 240 / 0.5)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        borderColor: "var(--color-border)",
                        borderRadius: "0.5rem",
                        fontSize: "12px",
                      }}
                      formatter={(val: any, name: any) => [
                        name === "liters" ? `${val} L` : `₹${val}`,
                        name === "liters" ? "Fuel Volume" : "Cost"
                      ]}
                    />
                    <Bar dataKey="liters" fill="oklch(0.60 0.18 155)" radius={[4, 4, 0, 0]} name="liters" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Trip Distance Trend */}
        {activeTab === "trips" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Route className="h-3.5 w-3.5 text-sky-500" />
                Trip Distance Travelled (km)
              </span>
              <span className="text-xs text-muted-foreground">
                {tripData.length} trips recorded
              </span>
            </div>

            {tripData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-xs text-muted-foreground">
                <Route className="h-8 w-8 text-muted-foreground/30 mb-2" />
                No trip records in this period
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tripData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.90 0.012 240 / 0.5)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        borderColor: "var(--color-border)",
                        borderRadius: "0.5rem",
                        fontSize: "12px",
                      }}
                      formatter={(val: any) => [`${val} km`, "Distance"]}
                    />
                    <Bar dataKey="distance" fill="oklch(0.60 0.17 230)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Maintenance Cost Trend */}
        {activeTab === "maintenance" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-amber-500" />
                Maintenance Service Spend (₹)
              </span>
              <span className="text-xs text-muted-foreground">
                {maintenanceCostData.length} service events
              </span>
            </div>

            {maintenanceCostData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-xs text-muted-foreground">
                <Wrench className="h-8 w-8 text-muted-foreground/30 mb-2" />
                No maintenance expense logs in this period
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={maintenanceCostData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.90 0.012 240 / 0.5)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        borderColor: "var(--color-border)",
                        borderRadius: "0.5rem",
                        fontSize: "12px",
                      }}
                      formatter={(val: any, _, item: any) => [`₹${Number(val).toLocaleString()}`, item?.payload?.service || "Cost"]}
                    />
                    <Bar dataKey="cost" fill="oklch(0.68 0.17 72)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
