"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FeatureCollection } from "geojson";
import { api, apiBaseUrl, type Session } from "../lib/api";

type MapConfig = {
  defaultStyle: "standard" | "satellite" | "hybrid";
  styleUrls: Record<string, string>;
  satellite: { enabled: boolean; note: string };
  tracking: { activeIntervalSeconds: number };
};

type Participant = {
  id: string;
  kind: "courier" | "merchant" | "customer" | "operator";
  label: string;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
  updatedAt: string | null;
  stale: boolean;
  orderId: string;
  orderNumber: string;
  status: string;
};

type ParticipantsResponse = {
  generatedAt: string;
  scope: string;
  participants: Participant[];
};

type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

const STYLE_LABELS: readonly { id: "standard" | "hybrid" | "satellite"; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "hybrid", label: "Hybrid" },
  { id: "satellite", label: "Satellite" }
];

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function LiveMap({ session }: { session: Session }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const activeStyleRef = useRef<string | null>(null);
  const fittedRef = useRef(false);
  const latestRef = useRef<Participant[]>([]);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [style, setStyle] = useState<"standard" | "hybrid" | "satellite">("hybrid");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api<MapConfig>("/v1/maps/config")
      .then((value) => {
        if (cancelled) return;
        setConfig(value);
        setStyle(value.defaultStyle);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load map configuration.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config || !containerRef.current || mapRef.current) return;
    const initialStyle = config.defaultStyle;
    const styleUrl = absoluteStyleUrl(config.styleUrls[initialStyle] ?? config.styleUrls.standard);
    if (!styleUrl) {
      setError("Map style is not configured.");
      return;
    }
    activeStyleRef.current = initialStyle;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [38.7578, 9.0192],
      zoom: 11,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");

    const apply = () => {
      const source = map.getSource("participants") as GeoJSONSource | undefined;
      source?.setData(toFeatureCollection(latestRef.current));
      if (!fittedRef.current && latestRef.current.length > 0) {
        fittedRef.current = true;
        const bounds = new maplibregl.LngLatBounds();
        for (const participant of latestRef.current) {
          bounds.extend([participant.longitude, participant.latitude]);
        }
        map.fitBounds(bounds, { padding: 72, maxZoom: 14.5, duration: 700 });
      }
    };

    map.on("style.load", apply);
    map.on("load", apply);
    map.on("error", (event) => {
      if (event.error?.message) setError(event.error.message);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      activeStyleRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    if (!config) return;
    const current = mapRef.current;
    if (!current || activeStyleRef.current === style) return;
    const styleUrl = absoluteStyleUrl(config.styleUrls[style] ?? config.styleUrls.standard);
    if (!styleUrl) return;
    activeStyleRef.current = style;
    current.setStyle(styleUrl);
  }, [style, config]);

  useEffect(() => {
    const source = mapRef.current?.getSource("participants") as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(participants));
  }, [participants]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const applySnapshot = (payload: ParticipantsResponse) => {
      latestRef.current = payload.participants;
      setParticipants(payload.participants);
      setConnection("live");
      setError("");
    };

    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const base = apiBaseUrl().replace(/^http/, "ws");
      socket = new WebSocket(`${base}/v1/tracking/participants/ws?access_token=${encodeURIComponent(session.accessToken)}`);
      socket.onopen = () => setConnection("live");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; data?: ParticipantsResponse };
          if ((message.type === "snapshot" || message.type === "participants") && message.data) {
            applySnapshot(message.data);
          }
        } catch {
          // Ignore malformed frames and keep the last good snapshot.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnection("offline");
        retry = setTimeout(connect, 5_000);
      };
      socket.onerror = () => socket?.close();
    };

    void api<ParticipantsResponse>("/v1/tracking/participants")
      .then(applySnapshot)
      .catch(() => undefined);
    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    };
  }, [session.accessToken]);

  const satelliteAvailable = config?.satellite.enabled ?? false;

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 3) return;
    setSearching(true);
    setSearchError("");
    try {
      const result = await api<{ results: GeocodeResult[] }>(`/v1/maps/search?q=${encodeURIComponent(query)}&limit=6`);
      setSearchResults(result.results);
    } catch (cause) {
      setSearchResults([]);
      setSearchError(cause instanceof Error ? cause.message : "Search is unavailable.");
    } finally {
      setSearching(false);
    }
  };

  const focusResult = (result: GeocodeResult) => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#e8613d" })
      .setLngLat([result.longitude, result.latitude])
      .setPopup(new maplibregl.Popup({ offset: 20 }).setText(result.formattedAddress))
      .addTo(map)
      .togglePopup();
    map.flyTo({ center: [result.longitude, result.latitude], zoom: 16, essential: true });
    setSearchResults([]);
    setSearchQuery(result.formattedAddress);
  };

  return (
    <div className="live-map-shell">
      <div className="live-map-toolbar">
        <div className="style-switch" role="group" aria-label="Map style">
          {STYLE_LABELS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={style === item.id ? "active" : ""}
              disabled={item.id === "satellite" && !satelliteAvailable}
              onClick={() => setStyle(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <form className="map-search" onSubmit={runSearch}>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search address or landmark"
            aria-label="Search the map"
          />
          <button type="submit" disabled={searching}>{searching ? "…" : "Search"}</button>
          {(searchResults.length > 0 || searchError) && (
            <div className="map-search-results">
              {searchError && <p className="fine-print">{searchError}</p>}
              {searchResults.map((result) => (
                <button type="button" key={`${result.latitude}:${result.longitude}:${result.formattedAddress}`} onClick={() => focusResult(result)}>
                  {result.formattedAddress}
                </button>
              ))}
            </div>
          )}
        </form>
        <span className={`status-pill ${connection === "live" ? "active" : "pending"}`}>
          {connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Reconnecting"}
        </span>
        <span className="fine-print">{participants.length} participants · updated {new Date().toLocaleTimeString()}</span>
      </div>
      <div ref={containerRef} className="live-map-canvas" />
      <div className="live-map-legend">
        <span><i className="dot courier" /> Courier</span>
        <span><i className="dot merchant" /> Merchant</span>
        <span><i className="dot customer" /> Customer</span>
        {!satelliteAvailable && <span className="fine-print">Satellite source not configured</span>}
      </div>
      {error && <p className="map-error">{error}</p>}
    </div>
  );
}

function absoluteStyleUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const origin = new URL(apiBaseUrl()).origin;
  return `${origin}${value.startsWith("/") ? "" : "/"}${value}`;
}

function toFeatureCollection(participants: readonly Participant[]): FeatureCollection {
  if (participants.length === 0) return EMPTY;
  return {
    type: "FeatureCollection",
    features: participants.map((participant) => ({
      type: "Feature",
      id: participant.id,
      geometry: { type: "Point", coordinates: [participant.longitude, participant.latitude] },
      properties: {
        id: participant.id,
        kind: participant.kind,
        label: participant.label,
        stale: participant.stale,
        orderId: participant.orderId,
        orderNumber: participant.orderNumber,
        status: participant.status
      }
    }))
  };
}
