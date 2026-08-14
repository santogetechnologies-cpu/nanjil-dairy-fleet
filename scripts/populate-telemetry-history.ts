import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://lorxcxmwmxsesuqyzxih.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function populateTelemetryHistoryForAllVehicles() {
  console.log("Fetching vehicles from Supabase...");
  const { data: vehicles, error: vErr } = await supabase.from("vehicles").select("id, number");

  if (vErr || !vehicles) {
    console.error("Error fetching vehicles:", vErr);
    return;
  }

  console.log(`Found ${vehicles.length} vehicles in Supabase.`);

  const now = Date.now();
  let insertedCount = 0;

  for (let idx = 0; idx < vehicles.length; idx++) {
    const v = vehicles[idx];
    
    // Check if telemetry_history already has records for this vehicle
    const { data: existing } = await supabase
      .from("telemetry_history")
      .select("id")
      .eq("vehicle_id", v.id)
      .limit(1);

    // Generate 6 historical telemetry snapshots over the past 24 hours
    const baseSpeed = (idx % 3 === 0) ? 45 : (idx % 3 === 1) ? 38 : 0;
    const baseFuel = 60 + (idx * 3) % 40;
    const baseTemp = Number((3.5 + (idx % 5) * 0.4).toFixed(1));
    const baseHumidity = 60 + (idx * 2) % 25;

    for (let h = 5; h >= 0; h--) {
      const timeAgo = new Date(now - h * 4 * 60 * 60 * 1000).toISOString();
      const speed = baseSpeed > 0 ? Math.max(10, baseSpeed + (h % 2 === 0 ? 5 : -5)) : 0;
      const fuel = Math.max(15, Math.min(100, baseFuel - h * 2));
      const temp = Number((baseTemp + (h % 2 === 0 ? 0.3 : -0.2)).toFixed(1));

      const { error: insertErr } = await supabase
        .from("telemetry_history")
        .insert({
          vehicle_id: v.id,
          speed: speed,
          fuel: fuel,
          temperature: temp,
          humidity: baseHumidity,
          recorded_at: timeAgo
        });

      if (!insertErr) {
        insertedCount++;
      } else {
        console.error(`Error inserting history for ${v.number}:`, insertErr.message);
      }
    }
  }

  console.log(`Successfully populated ${insertedCount} telemetry history records across ${vehicles.length} vehicles.`);
}

populateTelemetryHistoryForAllVehicles().catch(console.error);
