import { type ReactNode } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_LIBRARIES } from "./mapConstants";

interface Props {
  children: ReactNode;
}

export function GoogleMapProvider({ children }: Props) {
  // If no Google Maps API key is provided, safely render the application without crashing
  if (!GOOGLE_MAPS_API_KEY) {
    return <>{children}</>;
  }

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      libraries={GOOGLE_MAPS_LIBRARIES}
      onError={(err) => {
        console.warn("[Google Maps Platform Notice]", err);
      }}
    >
      {children}
    </APIProvider>
  );
}
