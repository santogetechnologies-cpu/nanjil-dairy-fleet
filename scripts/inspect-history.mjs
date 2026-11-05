import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://lorxcxmwmxsesuqyzxih.supabase.co",
  "sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb"
);

const checks = [
  "telemetry_history",
  "vehicle_telemetry",
  "trips",
  "trip_locations",
  "trip_routes",
  "gps_logs",
  "positions",
  "tracking_history",
  "telemetry_logs",
  "v_vehicles",
  "vehicle_stop_events",
  "fuel_purchase_logs",
  "alerts"
];

async function main() {
  for (const name of checks) {
    try {
      const { data, count, error } = await sb.from(name).select("*", { count: "exact" }).limit(3);
      if (!error) {
        console.log(`Table/View [${name}]: count = ${count ?? data?.length}`);
        if (data && data.length > 0) {
          console.log(`  Columns in [${name}]: ${Object.keys(data[0]).join(", ")}`);
          console.log(`  Sample row in [${name}]: ${JSON.stringify(data[0])}`);
        }
      } else {
        console.log(`Table/View [${name}]: ${error.message}`);
      }
    } catch (e) {
      console.log(`Table/View [${name}] error: ${e.message}`);
    }
  }
}

main();
