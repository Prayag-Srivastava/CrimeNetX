"use client";
/**
 * SuspectGeoMap — Leaflet map of suspect geo-movement (cell towers / GPS pings).
 * Renders a polyline + markers; falls back gracefully when no coordinates exist.
 */
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Fix default marker icon resolution under bundlers
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
  time?: string;
}

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
    }
  }, [points, map]);
  return null;
}

export function SuspectGeoMap({ points }: { points: GeoPoint[] }) {
  const center: [number, number] = useMemo(() => {
    if (points.length === 0) return [18.52, 73.86]; // Pune default
    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return [avgLat, avgLng];
  }, [points]);

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📍 Suspect Geo-Movement</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No geo-tracked points for this case yet — upload CCTV / GPS evidence to populate the trail.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📍 Suspect Geo-Movement Trail</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[380px] overflow-hidden rounded-lg border">
          <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={points} />
            <Polyline positions={points.map((p) => [p.lat, p.lng])} color="#dc2626" weight={3} />
            {points.map((p, i) => (
              <Marker key={i} position={[p.lat, p.lng]} icon={icon}>
                <Popup>
                  <b>{p.label}</b>
                  <br />
                  {p.time ?? ""}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}
