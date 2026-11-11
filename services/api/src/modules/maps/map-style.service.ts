import { Injectable } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import type { MapRuntimeSettings, MapStyleName } from "./maps.types.js";

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] } as const;

const COLORS = {
  surface: "#eef0e8",
  land: "#e7ebdf",
  park: "#d8e6cf",
  water: "#a9c6d6",
  building: "#d6d1c3",
  buildingEdge: "#bcb6a6",
  motorway: "#f6d383",
  primary: "#f7e6b5",
  minor: "#ffffff",
  casing: "#c9c3b4",
  label: "#25302a",
  labelHalo: "#ffffff",
  boundary: "#8d8a7f",
  route: "#b6f34a",
  routeCasing: "#1d3a22",
  routeCompleted: "#78877a",
  routeAlternative: "#7fa6c9",
  courier: "#b6f34a",
  merchant: "#f2a65a",
  customer: "#6ec1e4",
  operator: "#c7b9ff"
} as const;

export function buildMapStyle(settings: MapRuntimeSettings, name: MapStyleName): Record<string, unknown> {
  const wantsSatellite = name !== "standard" && Boolean(settings.satelliteTileUrl);
  const sources: Record<string, unknown> = {
    base: {
      type: "vector",
      tiles: [`${settings.tileServerUrl}/${settings.tileSet}/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 14,
      attribution: settings.attribution
    },
    participants: {
      type: "geojson",
      data: EMPTY_COLLECTION,
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 52
    },
    "delivery-route": { type: "geojson", data: EMPTY_COLLECTION },
    "delivery-route-completed": { type: "geojson", data: EMPTY_COLLECTION },
    "delivery-route-alternative": { type: "geojson", data: EMPTY_COLLECTION }
  };
  if (wantsSatellite && settings.satelliteTileUrl) {
    sources.satellite = {
      type: "raster",
      tiles: [settings.satelliteTileUrl],
      tileSize: 256,
      attribution: settings.attribution
    };
  }

  const layers: Record<string, unknown>[] = [];
  if (wantsSatellite) {
    layers.push(
      { id: "satellite", type: "raster", source: "satellite", paint: { "raster-opacity": 1, "raster-fade-duration": 200 } },
      { id: "satellite-shade", type: "background", paint: { "background-color": "rgba(23,32,26,0.16)" } }
    );
  } else {
    layers.push(
      { id: "background", type: "background", paint: { "background-color": COLORS.surface } }
    );
  }

  if (name === "standard") {
    layers.push(
      {
        id: "landuse",
        type: "fill",
        source: "base",
        "source-layer": "landuse",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["park", "grass", "forest", "wood", "meadow", "recreation_ground", "garden"],
            COLORS.park,
            ["residential", "commercial", "industrial"],
            COLORS.land,
            "rgba(0,0,0,0)"
          ],
          "fill-opacity": 0.8
        }
      },
      {
        id: "water",
        type: "fill",
        source: "base",
        "source-layer": "water",
        paint: { "fill-color": COLORS.water, "fill-opacity": 0.95 }
      },
      {
        id: "waterway",
        type: "line",
        source: "base",
        "source-layer": "waterway",
        paint: { "line-color": COLORS.water, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 2.5] }
      }
    );
  }

  // Roads are rendered on both standard and hybrid so the hybrid map remains
  // legible over satellite imagery.
  layers.push(
    {
      id: "road-casing",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 6,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": wantsSatellite ? "rgba(20,32,24,0.72)" : COLORS.casing,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 2.4, 18, 9]
      }
    },
    {
      id: "road-motorway",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ["match", ["get", "class"], ["motorway", "trunk"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": wantsSatellite ? "#f4e6b4" : COLORS.motorway,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 12, 2.6, 18, 10]
      }
    },
    {
      id: "road-primary",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 7,
      filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": wantsSatellite ? "#f7f0d8" : COLORS.primary,
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 12, 2, 18, 8]
      }
    },
    {
      id: "road-minor",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["minor", "residential", "unclassified", "service", "living_street"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": wantsSatellite ? "rgba(255,255,255,0.86)" : COLORS.minor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 5]
      }
    },
    {
      id: "rail",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 8,
      filter: ["==", ["get", "class"], "rail"],
      paint: { "line-color": "#9a9a90", "line-width": 1, "line-dasharray": [3, 2] }
    }
  );

  layers.push({
    id: "buildings",
    type: "fill",
    source: "base",
    "source-layer": settings.buildingsSourceLayer,
    minzoom: 13,
    paint: {
      "fill-color": wantsSatellite ? "rgba(239,235,220,0.28)" : COLORS.building,
      "fill-opacity": wantsSatellite ? 0.5 : 0.82
    }
  });
  layers.push({
    id: "buildings-outline",
    type: "line",
    source: "base",
    "source-layer": settings.buildingsSourceLayer,
    minzoom: 15,
    paint: { "line-color": wantsSatellite ? "rgba(255,255,255,0.55)" : COLORS.buildingEdge, "line-width": 0.6 }
  });

  layers.push(
    {
      id: "boundary",
      type: "line",
      source: "base",
      "source-layer": "boundary",
      minzoom: 4,
      filter: ["<=", ["get", "admin_level"], 6],
      paint: { "line-color": wantsSatellite ? "rgba(255,255,255,0.7)" : COLORS.boundary, "line-dasharray": [2, 2], "line-width": 1 }
    },
    {
      id: "road-labels",
      type: "symbol",
      source: "base",
      "source-layer": "transportation_name",
      minzoom: 13,
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"], ["get", "name:latin"]],
        "text-size": 11,
        "text-font": ["Noto Sans Regular"],
        "symbol-spacing": 380
      },
      paint: {
        "text-color": wantsSatellite ? "#ffffff" : COLORS.label,
        "text-halo-color": wantsSatellite ? "rgba(20,28,22,0.9)" : COLORS.labelHalo,
        "text-halo-width": 1.4
      }
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "base",
      "source-layer": "place",
      minzoom: 3,
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"], ["get", "name:latin"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 13, 14, 17],
        "text-max-width": 8,
        "text-anchor": "center"
      },
      paint: {
        "text-color": wantsSatellite ? "#ffffff" : COLORS.label,
        "text-halo-color": wantsSatellite ? "rgba(20,28,22,0.85)" : COLORS.labelHalo,
        "text-halo-width": 1.5
      }
    },
    {
      id: "poi-labels",
      type: "symbol",
      source: "base",
      "source-layer": "poi",
      minzoom: 15,
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"], ["get", "name:latin"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 0.6],
        "text-anchor": "top",
        "text-max-width": 7
      },
      paint: {
        "text-color": wantsSatellite ? "#f5f5ef" : "#4c5a50",
        "text-halo-color": wantsSatellite ? "rgba(20,28,22,0.9)" : COLORS.labelHalo,
        "text-halo-width": 1.2
      }
    }
  );

  layers.push(...routeLayers(), ...participantLayers());

  return {
    version: 8,
    name: `delivery_app ${name}`,
    glyphs: settings.glyphsUrl,
    ...(settings.spriteUrl ? { sprite: settings.spriteUrl } : {}),
    sources,
    layers
  };
}

function routeLayers(): Record<string, unknown>[] {
  return [
    {
      id: "delivery-route-alternative",
      type: "line",
      source: "delivery-route-alternative",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLORS.routeAlternative, "line-width": 4, "line-opacity": 0.55, "line-dasharray": [2, 2] }
    },
    {
      id: "delivery-route-completed",
      type: "line",
      source: "delivery-route-completed",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLORS.routeCompleted, "line-width": 4, "line-opacity": 0.7 }
    },
    {
      id: "delivery-route-casing",
      type: "line",
      source: "delivery-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLORS.routeCasing, "line-width": 10, "line-opacity": 0.65 }
    },
    {
      id: "delivery-route",
      type: "line",
      source: "delivery-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLORS.route, "line-width": 6, "line-opacity": 0.96 }
    },
    {
      id: "delivery-route-arrows",
      type: "symbol",
      source: "delivery-route",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 96,
        "text-field": "▶",
        "text-size": 13,
        "text-rotation-alignment": "map",
        "text-keep-upright": false,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-font": ["Noto Sans Regular"]
      },
      paint: { "text-color": COLORS.routeCasing, "text-halo-color": COLORS.route, "text-halo-width": 1 }
    }
  ];
}

function participantLayers(): Record<string, unknown>[] {
  return [
    {
      id: "participant-clusters",
      type: "circle",
      source: "participants",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#20301f",
        "circle-opacity": 0.86,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28, 200, 34],
        "circle-stroke-width": 2,
        "circle-stroke-color": COLORS.route
      }
    },
    {
      id: "participant-cluster-count",
      type: "symbol",
      source: "participants",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12
      },
      paint: { "text-color": "#f7f9f2" }
    },
    {
      id: "participant-points",
      type: "circle",
      source: "participants",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "match",
          ["get", "kind"],
          "courier",
          COLORS.courier,
          "merchant",
          COLORS.merchant,
          "customer",
          COLORS.customer,
          "operator",
          COLORS.operator,
          "#d6d1c3"
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 14, 8],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#132014",
        "circle-opacity": ["case", ["==", ["get", "stale"], true], 0.45, 1]
      }
    },
    {
      id: "participant-labels",
      type: "symbol",
      source: "participants",
      minzoom: 13,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["coalesce", ["get", "label"], ""],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 8
      },
      paint: {
        "text-color": "#1b241d",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.3
      }
    }
  ];
}

@Injectable()
export class MapStyleService {
  get(name: MapStyleName): Record<string, unknown> {
    const config = readRuntimeConfig();
    const settings: MapRuntimeSettings = {
      tileServerUrl: config.mapTileServerUrl,
      tileSet: config.mapTileSet,
      glyphsUrl: config.mapGlyphsUrl,
      spriteUrl: config.mapSpriteUrl,
      attribution: config.mapAttribution,
      satelliteTileUrl: config.mapSatelliteTileUrl,
      buildingsSourceLayer: config.mapBuildingsSourceLayer
    };
    return buildMapStyle(settings, name);
  }
}
