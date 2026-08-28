"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { SuspectGeoMap, type GeoPoint } from "@/components/maps/SuspectGeoMap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Evidence } from "@shared/types";

/**
 * Map page — builds geo points from evidence GPS metadata + CDR tower locations.
 */
export default function MapPage() {
  const { id } = useParams<{ id: string }>();
  const [points, setPoints] = useState<GeoPoint[]>([]);

  useEffect(() => {
    api
      .get<{ data: Evidence[] }>(`/evidence/case/${id}`)
      .then(({ data }) => {
        const geo = data.data
          .filter((e) => e.gpsLat && e.gpsLng)
          .map((e) => ({
            lat: e.gpsLat as number,
            lng: e.gpsLng as number,
            label: `${e.type} · ${e.fileName}`,
            time: new Date(e.uploadedAt).toLocaleString("en-IN"),
          }));
        setPoints(geo);
      })
      .catch(() => undefined);
  }, [id]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">🗺 Suspect Geo-Movement</h2>
        <p className="text-sm text-muted-foreground">
          GPS-tagged evidence locations ({points.length} points). Cell-tower triangulation is rendered when tower
          coordinates are ingested.
        </p>
      </div>
      <SuspectGeoMap points={points} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Movement log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {points.length === 0 && <p className="text-sm text-muted-foreground">No geo points recorded.</p>}
          {points.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span>{p.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
