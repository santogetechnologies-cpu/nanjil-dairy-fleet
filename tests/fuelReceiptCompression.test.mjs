import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUEL_RECEIPT_MIN_BYTES,
  FUEL_RECEIPT_MAX_BYTES,
  computeScaledDimensions,
  selectCompressionCandidate,
} from "../src/lib/imageCompression.ts";
import {
  submitDriverFuelRefillRpc,
  uploadCompressedFuelReceipt,
} from "../src/lib/driverOperationStatement.ts";

test("computeScaledDimensions preserves aspect ratio within maxEdge", () => {
  assert.deepEqual(computeScaledDimensions(4000, 3000, 1024), {
    width: 1024,
    height: 768,
  });
  assert.deepEqual(computeScaledDimensions(800, 600, 1024), {
    width: 800,
    height: 600,
  });
  assert.deepEqual(computeScaledDimensions(1500, 3000, 600), {
    width: 300,
    height: 600,
  });
});

test("selectCompressionCandidate keeps fuel receipt strictly within 10 KB - 50 KB target band", () => {
  assert.equal(FUEL_RECEIPT_MIN_BYTES, 10240);
  assert.equal(FUEL_RECEIPT_MAX_BYTES, 51200);

  const chosen = selectCompressionCandidate([
    { maxEdge: 1280, quality: 0.85, sizeBytes: 185000 },
    { maxEdge: 1024, quality: 0.56, sizeBytes: 44800 },
    { maxEdge: 800, quality: 0.44, sizeBytes: 26500 },
    { maxEdge: 480, quality: 0.25, sizeBytes: 8200 },
  ]);
  assert.ok(chosen);
  assert.equal(chosen.sizeBytes, 44800);
  assert.ok(chosen.sizeBytes >= FUEL_RECEIPT_MIN_BYTES && chosen.sizeBytes <= FUEL_RECEIPT_MAX_BYTES);

  // Already small image below 10 KB picks largest candidate <= 50 KB
  const tiny = selectCompressionCandidate([
    { maxEdge: 640, quality: 0.85, sizeBytes: 7900 },
    { maxEdge: 640, quality: 0.5, sizeBytes: 4200 },
  ]);
  assert.equal(tiny?.sizeBytes, 7900);

  // If every candidate exceeded 50 KB, picks smallest available fallback
  const oversized = selectCompressionCandidate([
    { maxEdge: 1024, quality: 0.5, sizeBytes: 90000 },
    { maxEdge: 200, quality: 0.18, sizeBytes: 54000 },
  ]);
  assert.equal(oversized?.sizeBytes, 54000);
});

test("uploadCompressedFuelReceipt uses storage bucket and falls back to compressed Data URL", async () => {
  const dummyBlob = new Blob(["compressed-jpg"], { type: "image/jpeg" });
  const storageOkClient = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/fuel-receipts/${path}` },
        }),
      }),
    },
  };

  const url = await uploadCompressedFuelReceipt(
    storageOkClient,
    "drv-1",
    dummyBlob,
    "data:image/jpeg;base64,fallback"
  );
  assert.match(url || "", /\/fuel-receipts\/drv-1\/receipt-.*\.jpg$/);

  const storageMissingClient = {
    storage: {
      from: () => ({
        upload: async () => ({ error: { message: "Bucket not found" } }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  };
  const fallbackUrl = await uploadCompressedFuelReceipt(
    storageMissingClient,
    "drv-1",
    dummyBlob,
    "data:image/jpeg;base64,fallback"
  );
  assert.equal(fallbackUrl, "data:image/jpeg;base64,fallback");
});

test("submitDriverFuelRefillRpc forwards p_receipt_photo_url with graceful 8-arg fallback", async () => {
  const calls = [];
  const client = {
    rpc: async (_fn, args) => {
      calls.push(args);
      if (calls.length === 1 && "p_receipt_photo_url" in args) {
        return {
          data: null,
          error: { message: "Could not find the function public.log_driver_fuel_refill (PGRST202)" },
        };
      }
      return { data: { ok: true, vehicle_odometer: 66910 }, error: null };
    },
  };

  const res = await submitDriverFuelRefillRpc(client, {
    vehicleId: "v-1",
    liters: 50,
    cost: 4725,
    odometer: 66910,
    isFullTank: true,
    pricePerLiter: 94.5,
    station: "Indian Oil Highway Pump",
    receiptRef: "INV-22",
    receiptPhotoUrl: "https://example.com/receipt.jpg",
  });

  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_receipt_photo_url, "https://example.com/receipt.jpg");
  assert.equal(calls[1].p_station, "Indian Oil Highway Pump");
});
