/**
 * VehicleMapImpl.tsx — Google Maps Fleet Vehicle Tracking Implementation
 * Powered by Google Maps Platform (@vis.gl/react-google-maps)
 */
import { GoogleVehicleMap, type GoogleVehicleMapProps } from "./maps";

export default function VehicleMapImpl(props: GoogleVehicleMapProps) {
  return <GoogleVehicleMap {...props} />;
}
