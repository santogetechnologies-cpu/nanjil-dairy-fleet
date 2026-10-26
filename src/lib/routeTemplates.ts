import { type RoutePoint } from "./roadRouting";

export interface RouteTemplate {
  id: string;
  name: string;
  description: string;
  startPoint: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  roundTripType: "same_path" | "different_path" | "one_way";
  revisitStopsOnReturn: boolean;
  outboundStops: RoutePoint[];
  returnStops: RoutePoint[];
  speedLimitKmh: number;
  deviationThresholdMeters: number;
}

// Regional Dairy Centers across Kanyakumari & South Tamil Nadu
export const NANJIL_DAIRY_DEPOT = {
  name: "Nanjil Central Processing Plant, Mulagumoodu",
  lat: 8.260765,
  lng: 77.288373,
};

export const PRESET_DAIRY_CENTRES = [
  { name: "Villukuri Milk Collection Centre", lat: 8.2435, lng: 77.3325 },
  { name: "Chunkankadai Chilling Unit", lat: 8.2045, lng: 77.3821 },
  { name: "Nagercoil Central Depot", lat: 8.1833, lng: 77.4119 },
  { name: "Vadasery Farmers Society", lat: 8.1925, lng: 77.4285 },
  { name: "Kottar Dairy Center", lat: 8.1712, lng: 77.4361 },
  { name: "Suchindram Bulk Milk Unit", lat: 8.1565, lng: 77.4562 },
  { name: "Agastheeswaram Collection Point", lat: 8.1255, lng: 77.4985 },
  { name: "Kanyakumari South Center", lat: 8.0883, lng: 77.5385 },
  { name: "Manakudy Coastal Society", lat: 8.0952, lng: 77.4812 },
  { name: "Rajakkamangalam Dairy Hub", lat: 8.1265, lng: 77.3912 },
  { name: "Eathamozhy Farm Point", lat: 8.1425, lng: 77.3621 },
  { name: "Colachel Harbour Cooperative", lat: 8.1755, lng: 77.2562 },
  { name: "Mandaikadu Center", lat: 8.1625, lng: 77.2825 },
  { name: "Thingal Nagar Dairy Center", lat: 8.2165, lng: 77.2785 },
  { name: "Eraniel Farmers Union", lat: 8.2045, lng: 77.3065 },
  { name: "Thuckalay Main Chilling Center", lat: 8.2485, lng: 77.3155 },
  { name: "Padmanabhapuram Depot", lat: 8.2425, lng: 77.3295 },
  { name: "Karungal Rural Dairy Society", lat: 8.2312, lng: 77.2025 },
  { name: "Kallukkoottam Station", lat: 8.2185, lng: 77.2285 },
  { name: "Midalam Coastal Society", lat: 8.2525, lng: 77.1725 },
  { name: "Pudukadai Farmers Center", lat: 8.2812, lng: 77.1685 },
  { name: "Marthandam Dairy Chilling Plant", lat: 8.3055, lng: 77.2185 },
  { name: "Kuzhithurai Riverbank Center", lat: 8.3185, lng: 77.1925 },
  { name: "Kaliakkavilai Border Depot", lat: 8.3412, lng: 77.1625 },
  { name: "Arumanai Highland Society", lat: 8.3725, lng: 77.2385 },
  { name: "Nedumangad Valley Center", lat: 8.3985, lng: 77.2625 },
  { name: "Kulasekharam Rubber Belt Center", lat: 8.3625, lng: 77.2985 },
  { name: "Thiruvattar Heritage Society", lat: 8.3325, lng: 77.2712 },
  { name: "Attoor Farmers Collection", lat: 8.3212, lng: 77.2895 },
  { name: "Surulacode Forest Fringe Depot", lat: 8.4112, lng: 77.3425 },
  { name: "Pechiparai Dam Dairy Outpost", lat: 8.4425, lng: 77.3125 },
  { name: "Balamore Tea Estate Collection", lat: 8.3885, lng: 77.4112 },
  { name: "Boothapandi Agri Center", lat: 8.2612, lng: 77.4485 },
  { name: "Thazhakudy Farm Unit", lat: 8.2325, lng: 77.4325 },
  { name: "Azhagappapuram Farmers Society", lat: 8.1655, lng: 77.5212 },
  { name: "Anjugramam Dairy Hub", lat: 8.1825, lng: 77.5625 },
  { name: "Chettikulam Coastal Unit", lat: 8.1985, lng: 77.6212 },
  { name: "Radhapuram Livestock Society", lat: 8.2912, lng: 77.6785 },
  { name: "Panagudi Valley Dairy Depot", lat: 8.3212, lng: 77.5825 },
  { name: "Aralvaimozhy Pass Center", lat: 8.2565, lng: 77.5112 },
];

export const DEFAULT_ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    id: "template-coastal-loop-35",
    name: "Coastal & Southern Dairy Loop (35 Stops)",
    description: "Extensive milk collection circuit covering southern coastal belt and agricultural societies.",
    startPoint: NANJIL_DAIRY_DEPOT,
    destination: { name: "Kanyakumari South Center", lat: 8.0883, lng: 77.5385 },
    roundTripType: "same_path",
    revisitStopsOnReturn: false,
    speedLimitKmh: 60,
    deviationThresholdMeters: 250,
    outboundStops: PRESET_DAIRY_CENTRES.slice(0, 35).map((c, i) => ({
      id: `stop-${i + 1}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      serviceDurationMins: 5,
      isMandatory: i % 4 !== 3, // ~75% mandatory, 25% optional
      status: "Pending",
    })),
    returnStops: [],
  },
  {
    id: "template-highland-different-path",
    name: "Western Foothills & High Altitude (Different Return Path)",
    description: "Round trip outbound through foothills and rubber belt, return via state highway bypass.",
    startPoint: NANJIL_DAIRY_DEPOT,
    destination: { name: "Kulasekharam Rubber Belt Center", lat: 8.3625, lng: 77.2985 },
    roundTripType: "different_path",
    revisitStopsOnReturn: false,
    speedLimitKmh: 55,
    deviationThresholdMeters: 200,
    outboundStops: [
      PRESET_DAIRY_CENTRES[15],
      PRESET_DAIRY_CENTRES[16],
      PRESET_DAIRY_CENTRES[17],
      PRESET_DAIRY_CENTRES[21],
      PRESET_DAIRY_CENTRES[22],
      PRESET_DAIRY_CENTRES[24],
      PRESET_DAIRY_CENTRES[26],
      PRESET_DAIRY_CENTRES[27],
      PRESET_DAIRY_CENTRES[28],
      PRESET_DAIRY_CENTRES[29],
      PRESET_DAIRY_CENTRES[30],
    ].map((c, i) => ({
      id: `out-stop-${i + 1}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      serviceDurationMins: 6,
      isMandatory: true,
      status: "Pending",
    })),
    returnStops: [
      PRESET_DAIRY_CENTRES[31],
      PRESET_DAIRY_CENTRES[32],
      PRESET_DAIRY_CENTRES[33],
      PRESET_DAIRY_CENTRES[0],
    ].map((c, i) => ({
      id: `ret-stop-${i + 1}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      serviceDurationMins: 5,
      isMandatory: false,
      status: "Pending",
    })),
  },
];
