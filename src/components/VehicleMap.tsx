import { lazy, Suspense } from "react";
import type { Vehicle } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface Props {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  routeHistory?: Array<{ lat: number; lng: number }>;
}

const LazyMap = lazy(() => import("./VehicleMapImpl"));

export function VehicleMap(props: Props) {
  const height = props.height ?? 520;
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center rounded-lg border border-border bg-muted/40"
          style={{ height }}
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LazyMap {...props} />
    </Suspense>
  );
}