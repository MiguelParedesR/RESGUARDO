export type PingPoint = {
  lat: number;
  lng: number;
  capturedAt: string;
};

export function haversineDistanceMeters(a: PingPoint, b: PingPoint) {
  const R = 6_371_000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return Math.round(R * c);
}

export function isLatePing(lastPingAt: string | null, thresholdMinutes: number) {
  if (!lastPingAt) return true;
  const diff = Date.now() - new Date(lastPingAt).getTime();
  return diff >= thresholdMinutes * 60_000;
}
