import { createClient } from '@supabase/supabase-js';
import { VEHICLES, DRIVERS, ALERTS, TRIPS, COLLECTION_ROUTES, MAINTENANCE } from './mock-data';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function mockIdToUuid(prefix: string, id: string): string {
  const num = id.replace(/[^0-9]/g, '');
  const padded = num.padStart(12, '0');
  const base = prefix === 'V' ? '00000000-0000-0000-0000' :
               prefix === 'D' ? '00000000-0000-0000-0001' :
               prefix === 'T' ? '00000000-0000-0000-0002' :
               prefix === 'A' ? '00000000-0000-0000-0003' :
               prefix === 'M' ? '00000000-0000-0000-0004' :
               prefix === 'R' ? '00000000-0000-0000-0005' :
                                '00000000-0000-0000-0006';
  return `${base}-${padded}`;
}

export async function initializeDatabase() {
  try {
    // 1. Check if vehicles exist
    const { count, error: countErr } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      // Silently skip if unauthorized (e.g. not logged in yet due to RLS policies)
      if (countErr.status === 401 || countErr.code === 'PGRST301') {
        return;
      }
      console.warn("Database initialization check failed. Tables might not be created yet.", countErr);
      return;
    }

    if (count === 0) {
      console.log("Supabase database is empty. Auto-seeding mock data...");

      // A. Seed Vehicles
      const vehiclesToInsert = VEHICLES.map(v => ({
        id: mockIdToUuid('V', v.id),
        number: v.number,
        type: v.type,
        model: v.model,
        route: v.route,
        insurance_expiry: v.insuranceExpiry,
        last_service: v.lastService,
        next_service_km: v.nextServiceKm,
        odometer: v.odometer,
        engine_hours: v.engineHours
      }));
      await supabase.from('vehicles').insert(vehiclesToInsert);

      // B. Seed Drivers
      const driversToInsert = DRIVERS.map(d => ({
        id: mockIdToUuid('D', d.id),
        name: d.name,
        phone: d.phone,
        license: d.license,
        score: d.score,
        events: d.events,
        rating: d.rating,
        trips: d.trips,
        total_km: d.totalKm
      }));
      await supabase.from('drivers').insert(driversToInsert);

      // C. Seed Vehicle Assignments
      const assignmentsToInsert = VEHICLES.map(v => ({
        vehicle_id: mockIdToUuid('V', v.id),
        driver_id: mockIdToUuid('D', v.driverId),
        is_active: true
      }));
      await supabase.from('vehicle_assignments').insert(assignmentsToInsert);

      // D. Seed Vehicle Telemetry
      const telemetryToInsert = VEHICLES.map(v => ({
        vehicle_id: mockIdToUuid('V', v.id),
        status: v.status,
        location: v.location,
        lat: v.lat,
        lng: v.lng,
        speed: v.speed,
        fuel: v.fuel,
        temperature: v.temperature,
        humidity: v.humidity,
        engine_on: v.engineOn,
        ignition: v.ignition
      }));
      await supabase.from('vehicle_telemetry').insert(telemetryToInsert);

      // E. Seed Alerts
      const alertsToInsert = ALERTS.map(a => {
        const vehicleObj = VEHICLES.find(x => x.number === a.vehicle) || VEHICLES[0];
        return {
          id: mockIdToUuid('A', a.id),
          type: a.type,
          severity: a.severity,
          vehicle_id: mockIdToUuid('V', vehicleObj.id),
          message: a.message,
          resolved: a.resolved
        };
      });
      await supabase.from('alerts').insert(alertsToInsert);

      // F. Seed Trips
      const tripsToInsert = TRIPS.map(t => {
        const vehicleObj = VEHICLES.find(x => x.number === t.vehicle) || VEHICLES[0];
        const driverObj = DRIVERS.find(x => x.name === t.driver) || DRIVERS[0];
        return {
          id: mockIdToUuid('T', t.id),
          vehicle_id: mockIdToUuid('V', vehicleObj.id),
          driver_id: mockIdToUuid('D', driverObj.id),
          date: t.date,
          start: t.start,
          destination: t.destination,
          distance: t.distance,
          duration: t.duration,
          status: t.status
        };
      });
      await supabase.from('trips').insert(tripsToInsert);

      // G. Seed Collection Routes
      const routesToInsert = COLLECTION_ROUTES.map(r => {
        const vehicleObj = VEHICLES.find(x => x.number === r.vehicle) || VEHICLES[0];
        const driverObj = DRIVERS.find(x => x.name === r.driver) || DRIVERS[0];
        return {
          id: mockIdToUuid('R', r.id),
          name: r.name,
          vehicle_id: mockIdToUuid('V', vehicleObj.id),
          driver_id: mockIdToUuid('D', driverObj.id),
          centres: r.centres,
          start_time: r.startTime,
          end_time: r.endTime,
          status: r.status,
          litres: r.litres,
          completion: r.completion
        };
      });
      await supabase.from('collection_routes').insert(routesToInsert);

      // H. Seed Maintenance Records
      const maintToInsert = MAINTENANCE.map(m => {
        const vehicleObj = VEHICLES.find(x => x.number === m.vehicle) || VEHICLES[0];
        return {
          id: mockIdToUuid('M', m.id),
          vehicle_id: mockIdToUuid('V', vehicleObj.id),
          service: m.service,
          due_in: m.dueIn,
          due_date: m.dueDate,
          status: m.status,
          cost: m.cost
        };
      });
      await supabase.from('maintenance_records').insert(maintToInsert);

      console.log("Database successfully seeded with mock data!");
    }
  } catch (err) {
    console.error("Error initializing/seeding database:", err);
  }
}
