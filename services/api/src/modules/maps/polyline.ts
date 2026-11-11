export type DecodedPoint = readonly [longitude: number, latitude: number];

export function decodePolyline(encoded: string, precision = 6): DecodedPoint[] {
  const factor = 10 ** precision;
  const points: DecodedPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const latResult = decodeChunk(encoded, index);
    index = latResult.index;
    if (latResult.delta === null) break;
    latitude += latResult.delta;

    const lngResult = decodeChunk(encoded, index);
    index = lngResult.index;
    if (lngResult.delta === null) break;
    longitude += lngResult.delta;

    points.push([longitude / factor, latitude / factor]);
  }
  return points;
}

function decodeChunk(encoded: string, start: number): { delta: number | null; index: number } {
  let index = start;
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (index >= encoded.length) return { delta: null, index };
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  const delta = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
  return { delta, index };
}
