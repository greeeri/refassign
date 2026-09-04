"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type CoordinateRow = {
  key: string;
  kind: "venue" | "home" | "alternate";
  id: string;
  weekday?: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const addressText = (...values: Array<string | null | undefined>) =>
  values.filter(Boolean).join(", ");

export default function MileageCoordinatesManager() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CoordinateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const [locations, officials, origins] = await Promise.all([
      supabase.from("locations").select("id,name,address,city,state,latitude,longitude").order("name"),
      supabase.from("officials").select("id,first_name,last_name,home_address,home_city,home_state,home_zip,home_latitude,home_longitude").eq("active", true).order("last_name").order("first_name"),
      supabase.from("official_weekday_origins").select("official_id,weekday,use_home,alternate_label,alternate_address,alternate_city,alternate_state,alternate_zip,alternate_latitude,alternate_longitude").eq("use_home", false).order("weekday"),
    ]);
    const loadError = locations.error || officials.error || origins.error;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const officialNames = new Map(
      (officials.data || []).map((o) => [o.id, `${o.first_name || ""} ${o.last_name || ""}`.trim()]),
    );
    const next: CoordinateRow[] = [
      ...(locations.data || []).map((v) => ({
        key: `venue:${v.id}`,
        kind: "venue" as const,
        id: v.id,
        name: v.name || "Unnamed venue",
        address: addressText(v.address, v.city, v.state),
        latitude: v.latitude == null ? null : Number(v.latitude),
        longitude: v.longitude == null ? null : Number(v.longitude),
      })),
      ...(officials.data || []).map((o) => ({
        key: `home:${o.id}`,
        kind: "home" as const,
        id: o.id,
        name: `${o.first_name || ""} ${o.last_name || ""}`.trim() || "Official",
        address: addressText(o.home_address, o.home_city, o.home_state, o.home_zip),
        latitude: o.home_latitude == null ? null : Number(o.home_latitude),
        longitude: o.home_longitude == null ? null : Number(o.home_longitude),
      })),
      ...(origins.data || []).map((o) => ({
        key: `alternate:${o.official_id}:${o.weekday}`,
        kind: "alternate" as const,
        id: o.official_id,
        weekday: o.weekday,
        name: `${officialNames.get(o.official_id) || "Official"} — ${days[o.weekday]} — ${o.alternate_label || "Different Location"}`,
        address: addressText(o.alternate_address, o.alternate_city, o.alternate_state, o.alternate_zip),
        latitude: o.alternate_latitude == null ? null : Number(o.alternate_latitude),
        longitude: o.alternate_longitude == null ? null : Number(o.alternate_longitude),
      })),
    ];
    setRows(next);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function patch(key: string, values: Partial<CoordinateRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...values } : row)));
  }

  function validCoordinate(row: CoordinateRow) {
    return (
      row.latitude != null &&
      row.longitude != null &&
      Number.isFinite(Number(row.latitude)) &&
      Number.isFinite(Number(row.longitude)) &&
      Number(row.latitude) >= -90 &&
      Number(row.latitude) <= 90 &&
      Number(row.longitude) >= -180 &&
      Number(row.longitude) <= 180
    );
  }

  async function save(row: CoordinateRow) {
    if (!validCoordinate(row)) {
      setError("Latitude must be -90 to 90 and longitude must be -180 to 180.");
      return;
    }
    setSaving(row.key);
    setError("");
    setNotice("");
    const latitude = Number(row.latitude), longitude = Number(row.longitude);
    const result =
      row.kind === "venue"
        ? await supabase.from("locations").update({ latitude, longitude }).eq("id", row.id)
        : row.kind === "home"
          ? await supabase.from("officials").update({ home_latitude: latitude, home_longitude: longitude }).eq("id", row.id)
          : await supabase.from("official_weekday_origins").update({ alternate_latitude: latitude, alternate_longitude: longitude, updated_at: new Date().toISOString() }).eq("official_id", row.id).eq("weekday", row.weekday!);
    if (result.error) setError(result.error.message);
    else setNotice(`${row.name} coordinates saved. Payroll will use them immediately.`);
    setSaving("");
  }

  async function retry(row: CoordinateRow) {
    if (!row.address && row.kind !== "venue") {
      setError(`Add an address for ${row.name} before retrying the lookup.`);
      return;
    }
    setSaving(`lookup:${row.key}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(row.address || row.name)}&name=${encodeURIComponent(row.kind === "venue" ? row.name : "")}`);
      const result = (await response.json()) as { latitude?: number; longitude?: number; error?: string };
      if (!response.ok || result.latitude == null || result.longitude == null)
        throw new Error(result.error || `Could not locate ${row.name}.`);
      const updated = { ...row, latitude: result.latitude, longitude: result.longitude };
      patch(row.key, { latitude: result.latitude, longitude: result.longitude });
      await save(updated);
      setNotice(`${row.name} was located and saved.`);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : `Could not locate ${row.name}. Enter coordinates manually.`);
    }
    setSaving("");
  }

  const missing = rows.filter((row) => !validCoordinate(row)).length;
  const sorted = [...rows].sort((a, b) => {
    const aMissing = validCoordinate(a) ? 1 : 0, bMissing = validCoordinate(b) ? 1 : 0;
    return aMissing - bMissing || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  });

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h3>Mileage Location Coordinates</h3>
          <p>Assignors can correct any venue, referee home, or alternate starting location that cannot be found automatically.</p>
        </div>
        <button className="secondary" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>
      <p><small>{missing ? `${missing} location${missing === 1 ? "" : "s"} still need coordinates. Missing locations are listed first.` : "All saved mileage locations have coordinates."} Retry Lookup uses the configured automatic geocoding services; manual coordinates always override a failed lookup.</small></p>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      {loading ? <p>Loading mileage locations…</p> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>Type</th><th>Location / Official</th><th>Address</th><th>Latitude</th><th>Longitude</th><th></th></tr></thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.key}>
                  <td><span className={`badge ${validCoordinate(row) ? "green" : "amber"}`}>{row.kind === "venue" ? "Venue" : row.kind === "home" ? "Home" : "Alternate"}</span></td>
                  <td><b>{row.name}</b><small>{validCoordinate(row) ? "Coordinates available" : "Coordinates needed"}</small></td>
                  <td>{row.address || <span>Address not entered</span>}</td>
                  <td><input aria-label={`${row.name} latitude`} type="number" step="0.000001" min="-90" max="90" value={row.latitude ?? ""} onChange={(e) => patch(row.key, { latitude: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td><input aria-label={`${row.name} longitude`} type="number" step="0.000001" min="-180" max="180" value={row.longitude ?? ""} onChange={(e) => patch(row.key, { longitude: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td><div className="headerActions"><button className="secondary" disabled={Boolean(saving)} onClick={() => void retry(row)}>{saving === `lookup:${row.key}` ? "Looking…" : "Retry Lookup"}</button><button className="primary" disabled={Boolean(saving) || !validCoordinate(row)} onClick={() => void save(row)}>{saving === row.key ? "Saving…" : "Save"}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
