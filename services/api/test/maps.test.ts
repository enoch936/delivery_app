import assert from "node:assert/strict";
import test from "node:test";
import { buildMapStyle } from "../src/modules/maps/map-style.service.js";
import { decodePolyline } from "../src/modules/maps/polyline.js";
import type { MapRuntimeSettings } from "../src/modules/maps/maps.types.js";

const settings: MapRuntimeSettings = {
  tileServerUrl: "http://tiles.test",
  tileSet: "ethiopia",
  glyphsUrl: "http://tiles.test/fonts/{fontstack}/{range}.pbf",
  spriteUrl: undefined,
  attribution: "© OpenStreetMap contributors",
  satelliteTileUrl: "http://imagery.test/{z}/{x}/{y}.png",
  buildingsSourceLayer: "building"
};

test("decodes Valhalla polyline shapes into longitude/latitude pairs", () => {
  const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
  assert.deepEqual(points, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252]
  ]);
});

test("builds a hybrid style with a satellite raster and arrowed route layer", () => {
  const style = buildMapStyle(settings, "hybrid");
  const sources = style.sources as Record<string, Record<string, unknown>>;
  const layers = style.layers as Record<string, unknown>[];
  assert.equal(sources.satellite?.type, "raster");
  assert.ok(layers.some((layer) => layer.id === "delivery-route-arrows"));
  assert.ok(layers.some((layer) => layer.id === "participant-points"));
  assert.equal(style.glyphs, settings.glyphsUrl);
});

test("standard style never depends on satellite imagery", () => {
  const style = buildMapStyle(settings, "standard");
  const sources = style.sources as Record<string, Record<string, unknown>>;
  assert.equal(sources.satellite, undefined);
});

test("satellite style falls back to the vector base when no imagery is configured", () => {
  const style = buildMapStyle({ ...settings, satelliteTileUrl: undefined }, "satellite");
  const sources = style.sources as Record<string, Record<string, unknown>>;
  assert.equal(sources.satellite, undefined);
  assert.equal(sources.base?.type, "vector");
});
