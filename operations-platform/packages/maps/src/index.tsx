import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";

export type LatLng = [number, number];

type OpsMapProps = {
  current: LatLng;
  destination?: LatLng;
  route?: LatLng[];
};

export function OpsMap({ current, destination, route = [] }: OpsMapProps) {
  const line = route.length > 1 ? route : destination ? [current, destination] : [];

  return (
    <div className="overflow-hidden rounded-operation border border-panel-line">
      <MapContainer
        center={current}
        zoom={13}
        style={{ height: 340, width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={current} />
        {destination ? <Marker position={destination} /> : null}
        {line.length > 1 ? <Polyline positions={line} color="#f09a35" /> : null}
      </MapContainer>
    </div>
  );
}
