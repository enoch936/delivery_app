export type MapStyleName = "standard" | "satellite" | "hybrid";

export type MapRuntimeSettings = Readonly<{
  tileServerUrl: string;
  tileSet: string;
  glyphsUrl: string;
  spriteUrl: string | undefined;
  attribution: string;
  satelliteTileUrl: string | undefined;
  buildingsSourceLayer: string;
}>;

export type GeoPoint = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type RouteProfile = "auto" | "motorcycle" | "pedestrian" | "bicycle";

export type RouteManeuver = Readonly<{
  instruction: string;
  spokenInstruction: string;
  type: number;
  streetNames: readonly string[];
  distanceMeters: number;
  durationSeconds: number;
  beginShapeIndex: number;
  endShapeIndex: number;
  roundaboutExit: number | null;
}>;

export type RouteLeg = Readonly<{
  distanceMeters: number;
  durationSeconds: number;
  maneuvers: readonly RouteManeuver[];
}>;

export type RouteResult = Readonly<{
  provider: "valhalla";
  profile: RouteProfile;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Readonly<{ type: "LineString"; coordinates: readonly (readonly [number, number])[] }>;
  legs: readonly RouteLeg[];
  alternatives: readonly Readonly<{
    distanceMeters: number;
    durationSeconds: number;
    geometry: Readonly<{ type: "LineString"; coordinates: readonly (readonly [number, number])[] }>;
  }>[];
}>;
