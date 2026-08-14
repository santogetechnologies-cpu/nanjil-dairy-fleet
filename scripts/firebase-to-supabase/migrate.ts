import { createClient } from "@supabase/supabase-js";

// Types for Firebase Document & Migration Result
export interface FirebaseVechileDoc {
  id: string; // Document ID (e.g. 863110086186932)
  device_id?: string | number;
  "v.no"?: string;
  lat?: string | number;
  lng?: string | number;
  speed?: number | string;
  fuel?: number | string;
  temperature?: number | string;
  humidity?: number | string;
  engine_on?: boolean | string;
  ignition?: boolean | string;
  status?: string;
  [key: string]: any;
}

export interface MigrationSummary {
  collectionName: string;
  totalFound: number;
  validDocuments: number;
  invalidDocuments: number;
  existingSupabaseVehicles: number;
  vehiclesToCreate: number;
  vehiclesToUpdate: number;
  telemetryToUpsert: number;
  historyToInsert: number;
  skipped: number;
  errors: string[];
  missingRequiredFields: string[];
  duplicateDeviceIds: string[];
  schemaMismatches: string[];
  details: any[];
}

// Environment variables
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://lorxcxmwmxsesuqyzxih.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "nanjil-fleet";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Fetch raw documents from Firebase Firestore "vechile" collection via REST API
 */
export async function fetchFirebaseVechileDocs(): Promise<FirebaseVechileDoc[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/vechile?pageSize=300`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase collection: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json.documents || !Array.isArray(json.documents)) {
    return [];
  }

  return json.documents.map((docItem: any) => {
    const nameParts = docItem.name.split("/");
    const docId = nameParts[nameParts.length - 1];
    const fields = docItem.fields || {};

    const data: FirebaseVechileDoc = { id: docId };

    for (const [key, valObj] of Object.entries<any>(fields)) {
      if ("stringValue" in valObj) data[key] = valObj.stringValue;
      else if ("integerValue" in valObj) data[key] = parseInt(valObj.integerValue, 10);
      else if ("doubleValue" in valObj) data[key] = parseFloat(valObj.doubleValue);
      else if ("booleanValue" in valObj) data[key] = valObj.booleanValue;
      else if ("nullValue" in valObj) data[key] = null;
    }

    return data;
  });
}

/**
 * Run migration with specified mode: dry-run or execute
 */
export async function runMigration(isExecuteMode = false): Promise<MigrationSummary> {
  const modeName = isExecuteMode ? "EXECUTE" : "DRY RUN";
  console.log(`\n========================================`);
  console.log(`NANJIL FIREBASE → SUPABASE MIGRATION (${modeName})`);
  console.log(`========================================\n`);

  const summary: MigrationSummary = {
    collectionName: "vechile",
    totalFound: 0,
    validDocuments: 0,
    invalidDocuments: 0,
    existingSupabaseVehicles: 0,
    vehiclesToCreate: 0,
    vehiclesToUpdate: 0,
    telemetryToUpsert: 0,
    historyToInsert: 0,
    skipped: 0,
    errors: [],
    missingRequiredFields: [],
    duplicateDeviceIds: [],
    schemaMismatches: [],
    details: []
  };

  try {
    // 1. Read Supabase existing vehicles
    const { data: existingVehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id, number, device_id, model, type");

    if (vErr) {
      throw new Error(`Failed to fetch existing Supabase vehicles: ${vErr.message}`);
    }

    summary.existingSupabaseVehicles = existingVehicles?.length || 0;
    console.log(`Found ${summary.existingSupabaseVehicles} existing vehicles in Supabase.`);

    // 2. Fetch Firebase documents
    const rawDocs = await fetchFirebaseVechileDocs();
    summary.totalFound = rawDocs.length;
    console.log(`Fetched ${summary.totalFound} documents from Firebase 'vechile' collection.`);

    const deviceIdSeen = new Set<string>();

    for (const doc of rawDocs) {
      const docDetail: any = { firebaseDocId: doc.id, actions: [] };

      // Determine external device identity: preference to 15-digit doc ID or device_id
      let deviceId: string | null = null;
      if (doc.id && /^\d{15}$/.test(doc.id)) {
        deviceId = String(doc.id);
      } else if (doc.device_id != null) {
        deviceId = String(doc.device_id);
      } else {
        deviceId = String(doc.id);
      }

      if (deviceIdSeen.has(deviceId)) {
        summary.duplicateDeviceIds.push(deviceId);
      }
      deviceIdSeen.add(deviceId);

      // Validate required device identification
      if (!deviceId) {
        summary.invalidDocuments++;
        summary.missingRequiredFields.push(`Doc ${doc.id}: Missing device_id`);
        docDetail.status = "INVALID: Missing device_id";
        summary.details.push(docDetail);
        continue;
      }

      summary.validDocuments++;

      // Type Normalization
      const latNum = doc.lat != null ? parseFloat(String(doc.lat)) : null;
      const lngNum = doc.lng != null ? parseFloat(String(doc.lng)) : null;
      const speedNum = doc.speed != null ? Math.max(0, parseInt(String(doc.speed), 10) || 0) : 0;
      const fuelNum = doc.fuel != null ? Math.min(100, Math.max(0, parseInt(String(doc.fuel), 10) || 0)) : 0;
      const tempNum = doc.temperature != null ? parseFloat(String(doc.temperature)) : null;
      const humidityNum = doc.humidity != null ? Math.min(100, Math.max(0, parseInt(String(doc.humidity), 10) || 0)) : null;
      const engineOnBool = typeof doc.engine_on === "boolean" ? doc.engine_on : String(doc.engine_on).toLowerCase() === "true";
      const ignitionBool = typeof doc.ignition === "boolean" ? doc.ignition : String(doc.ignition).toLowerCase() === "true";
      const statusStr = (doc.status || "Offline") as "Moving" | "Idle" | "Parked" | "Offline";
      const vehicleNumStr = doc["v.no"] ? String(doc["v.no"]).trim() : null;

      // Track schema conversions for reporting
      if (typeof doc.lat === "string") {
        summary.schemaMismatches.push(`Doc ${doc.id}: lat converted from string "${doc.lat}" to numeric ${latNum}`);
      }
      if (typeof doc.lng === "string") {
        summary.schemaMismatches.push(`Doc ${doc.id}: lng converted from string "${doc.lng}" to numeric ${lngNum}`);
      }

      // Match vehicle in Supabase
      let matchedVehicle = existingVehicles?.find(v => v.device_id === deviceId);

      // Secondary match by vehicle number if device_id wasn't matched yet
      if (!matchedVehicle && vehicleNumStr) {
        matchedVehicle = existingVehicles?.find(v => v.number.replace(/\s+/g, "").toUpperCase() === vehicleNumStr.replace(/\s+/g, "").toUpperCase());
      }

      let vehicleIdToUse: string | null = null;

      if (matchedVehicle) {
        vehicleIdToUse = matchedVehicle.id;
        docDetail.matchedVehicle = matchedVehicle.number;

        // Check if we need to set device_id on vehicle
        if (!matchedVehicle.device_id && deviceId && /^\d{15}$/.test(deviceId)) {
          summary.vehiclesToUpdate++;
          docDetail.actions.push(`Update vehicles.device_id to '${deviceId}'`);
          if (isExecuteMode) {
            const { error: updErr } = await supabase
              .from("vehicles")
              .update({ device_id: deviceId, updated_at: new Date().toISOString() })
              .eq("id", matchedVehicle.id);
            if (updErr) summary.errors.push(`Error updating vehicle ${matchedVehicle.id} device_id: ${updErr.message}`);
          }
        }
      } else {
        // Vehicle does not exist in Supabase
        if (!vehicleNumStr) {
          summary.missingRequiredFields.push(`Doc ${doc.id}: Vehicle number unavailable, cannot create vehicle record safely.`);
          summary.skipped++;
          docDetail.status = "SKIPPED: Missing vehicle number";
          summary.details.push(docDetail);
          continue;
        }

        summary.vehiclesToCreate++;
        docDetail.actions.push(`Create vehicle '${vehicleNumStr}' with device_id '${deviceId}'`);

        if (isExecuteMode) {
          const { data: newV, error: createErr } = await supabase
            .from("vehicles")
            .insert({
              number: vehicleNumStr,
              type: "Container",
              model: "Fleet Device Vehicle",
              device_id: /^\d{15}$/.test(deviceId) ? deviceId : null
            })
            .select("id")
            .single();

          if (createErr) {
            summary.errors.push(`Error creating vehicle for doc ${doc.id}: ${createErr.message}`);
            docDetail.status = `ERROR: ${createErr.message}`;
            summary.details.push(docDetail);
            continue;
          }
          vehicleIdToUse = newV.id;
        }
      }

      // Prepare Telemetry Snapshot
      summary.telemetryToUpsert++;
      docDetail.actions.push(`Upsert vehicle_telemetry (status=${statusStr}, speed=${speedNum}, fuel=${fuelNum}, temp=${tempNum})`);

      if (isExecuteMode && vehicleIdToUse) {
        const telemetryPayload: any = {
          vehicle_id: vehicleIdToUse,
          status: statusStr,
          lat: latNum,
          lng: lngNum,
          speed: speedNum,
          fuel: fuelNum,
          temperature: tempNum,
          humidity: humidityNum,
          engine_on: engineOnBool,
          ignition: ignitionBool,
          last_update: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error: telemErr } = await supabase
          .from("vehicle_telemetry")
          .upsert(telemetryPayload, { onConflict: "vehicle_id" });

        if (telemErr) {
          summary.errors.push(`Error upserting telemetry for vehicle ${vehicleIdToUse}: ${telemErr.message}`);
        }
      }

      // Idempotent History Snapshot
      summary.historyToInsert++;
      docDetail.actions.push(`Insert telemetry_history`);

      if (isExecuteMode && vehicleIdToUse) {
        // Deduplication check: check if history logged within last 1 minute
        const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: existingHist } = await supabase
          .from("telemetry_history")
          .select("id")
          .eq("vehicle_id", vehicleIdToUse)
          .gte("recorded_at", oneMinAgo)
          .limit(1);

        if (!existingHist || existingHist.length === 0) {
          const { error: histErr } = await supabase
            .from("telemetry_history")
            .insert({
              vehicle_id: vehicleIdToUse,
              speed: speedNum,
              fuel: fuelNum,
              temperature: tempNum,
              humidity: humidityNum,
              recorded_at: new Date().toISOString()
            });

          if (histErr) {
            summary.errors.push(`Error inserting telemetry_history for vehicle ${vehicleIdToUse}: ${histErr.message}`);
          }
        }
      }

      docDetail.status = "SUCCESS";
      summary.details.push(docDetail);
    }
  } catch (err: any) {
    summary.errors.push(`Fatal migration error: ${err.message}`);
  }

  // Print Summary Table
  console.log(`\n========================================`);
  console.log(`SUMMARY RESULT (${modeName})`);
  console.log(`========================================`);
  console.log(`Firebase collection:                  ${summary.collectionName}`);
  console.log(`Documents found:                      ${summary.totalFound}`);
  console.log(`Valid documents:                      ${summary.validDocuments}`);
  console.log(`Invalid documents:                    ${summary.invalidDocuments}`);
  console.log(`Existing Supabase vehicles:           ${summary.existingSupabaseVehicles}`);
  console.log(`Vehicles to create:                   ${summary.vehiclesToCreate}`);
  console.log(`Vehicles to update:                   ${summary.vehiclesToUpdate}`);
  console.log(`Telemetry records to create/update:   ${summary.telemetryToUpsert}`);
  console.log(`History records:                      ${summary.historyToInsert}`);
  console.log(`Skipped:                              ${summary.skipped}`);
  console.log(`Errors:                               ${summary.errors.length}`);
  console.log(`========================================\n`);

  return summary;
}
