import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://lorxcxmwmxsesuqyzxih.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TEST_TELEMETRY = [
  {
    number: "TN 75 AS 6366", // Migrated vehicle
    status: "Moving",
    lat: 8.2523,
    lng: 77.4532,
    speed: 48,
    fuel: 85,
    temperature: 4.2,
    humidity: 65,
    engine_on: true,
    ignition: true,
    location: "Thuckalay - Nagercoil Highway"
  },
  {
    number: "TN 75 M 0041",
    status: "Moving",
    lat: 8.3000,
    lng: 77.2000,
    speed: 52,
    fuel: 78,
    temperature: 3.8,
    humidity: 70,
    engine_on: true,
    ignition: true,
    location: "Marthandam Sector 4 Collection Route"
  },
  {
    number: "TN 75 C 8204",
    status: "Idle",
    lat: 8.2500,
    lng: 77.3333,
    speed: 0,
    fuel: 92,
    temperature: 4.5,
    humidity: 72,
    engine_on: true,
    ignition: false,
    location: "Thuckalay Chilling Centre Yard"
  },
  {
    number: "TN 75 F 4323",
    status: "Moving",
    lat: 8.1833,
    lng: 77.4119,
    speed: 40,
    fuel: 64,
    temperature: 4.0,
    humidity: 68,
    engine_on: true,
    ignition: true,
    location: "Nagercoil Central Depot"
  },
  {
    number: "TN 75 R 9952",
    status: "Parked",
    lat: 8.3833,
    lng: 77.6167,
    speed: 0,
    fuel: 55,
    temperature: 5.1,
    humidity: 60,
    engine_on: false,
    ignition: false,
    location: "Valliyur Interstate Station"
  },
  {
    number: "TN 75 S 1688",
    status: "Moving",
    lat: 8.1764,
    lng: 77.2611,
    speed: 36,
    fuel: 71,
    temperature: 4.1,
    humidity: 66,
    engine_on: true,
    ignition: true,
    location: "Colachel Coastal Line"
  },
  {
    number: "TN 75 BJ 4692",
    status: "Moving",
    lat: 8.0883,
    lng: 77.5385,
    speed: 45,
    fuel: 88,
    temperature: 3.9,
    humidity: 64,
    engine_on: true,
    ignition: true,
    location: "Kanyakumari Express Route"
  },
  {
    number: "TN75 BE 8960",
    status: "Idle",
    lat: 8.2700,
    lng: 77.6800,
    speed: 0,
    fuel: 80,
    temperature: 4.3,
    humidity: 75,
    engine_on: true,
    ignition: false,
    location: "Radhapuram Milk Collection Hub"
  }
];

export async function seedTelemetryForTracking() {
  console.log("Fetching vehicles from Supabase...");
  const { data: vehicles, error: vErr } = await supabase.from("vehicles").select("id, number");
  if (vErr || !vehicles) {
    console.error("Error fetching vehicles:", vErr);
    return;
  }

  console.log(`Found ${vehicles.length} vehicles.`);

  for (const item of TEST_TELEMETRY) {
    const matchedV = vehicles.find(v => v.number.replace(/\s+/g, "").toUpperCase() === item.number.replace(/\s+/g, "").toUpperCase());
    if (!matchedV) {
      console.warn(`Vehicle '${item.number}' not found in Supabase.`);
      continue;
    }

    console.log(`Updating telemetry for ${item.number} (ID: ${matchedV.id})...`);

    const telemetryPayload = {
      vehicle_id: matchedV.id,
      status: item.status,
      lat: item.lat,
      lng: item.lng,
      speed: item.speed,
      fuel: item.fuel,
      temperature: item.temperature,
      humidity: item.humidity,
      engine_on: item.engine_on,
      ignition: item.ignition,
      location: item.location,
      last_update: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: tErr } = await supabase
      .from("vehicle_telemetry")
      .upsert(telemetryPayload, { onConflict: "vehicle_id" });

    if (tErr) console.error(`Error updating telemetry for ${item.number}:`, tErr.message);

    // Insert 5 history points to simulate tracking timeline
    const now = Date.now();
    for (let i = 4; i >= 0; i--) {
      const timeAgo = new Date(now - i * 15 * 60 * 1000).toISOString();
      const speedVar = item.status === "Moving" ? Math.max(10, item.speed + (i % 2 === 0 ? 5 : -5)) : 0;
      const fuelVar = Math.max(10, item.fuel + i * 2);
      const tempVar = Number((item.temperature + (i % 2 === 0 ? 0.2 : -0.2)).toFixed(1));

      await supabase.from("telemetry_history").insert({
        vehicle_id: matchedV.id,
        speed: speedVar,
        fuel: fuelVar,
        temperature: tempVar,
        humidity: item.humidity,
        recorded_at: timeAgo
      });
    }

    console.log(`Successfully updated ${item.number} telemetry & history.`);
  }

  console.log("Telemetry seeding complete!");
}
