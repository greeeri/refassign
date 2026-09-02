"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Official = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  home_latitude: number | null;
  home_longitude: number | null;
  certification_level: string | null;
  profile_picture_url: string | null;
};
type Origin = {
  official_id: string;
  weekday: number;
  use_home: boolean;
  alternate_label: string;
  alternate_address: string;
  alternate_city: string;
  alternate_state: string;
  alternate_zip: string;
  alternate_latitude: number | null;
  alternate_longitude: number | null;
};
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const blankOrigin = (
  official_id: string,
  weekday: number,
  state: string,
): Origin => ({
  official_id,
  weekday,
  use_home: true,
  alternate_label: "",
  alternate_address: "",
  alternate_city: "",
  alternate_state: state || "IA",
  alternate_zip: "",
  alternate_latitude: null,
  alternate_longitude: null,
});

async function coordinatesFor(address: string) {
  const response = await fetch(
    `/api/geocode?address=${encodeURIComponent(address)}`,
  );
  const result = (await response.json()) as {
    latitude?: number;
    longitude?: number;
    error?: string;
  };
  if (!response.ok || result.latitude == null || result.longitude == null)
    throw new Error(result.error || `Could not locate ${address}.`);
  return { latitude: result.latitude, longitude: result.longitude };
}

export default function OfficialProfile() {
  const supabase = useMemo(() => createClient(), []);
  const [official, setOfficial] = useState<Official | null>(null),
    [origins, setOrigins] = useState<Origin[]>([]),
    [userId, setUserId] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    async function load() {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setError("Please sign in.");
        return;
      }
      setUserId(u.user.id);
      const { data, error: e } = await supabase
        .from("officials")
        .select(
          "id,first_name,last_name,email,phone,home_address,home_city,home_state,home_zip,home_latitude,home_longitude,certification_level,profile_picture_url",
        )
        .eq("auth_user_id", u.user.id)
        .maybeSingle();
      if (e) setError(e.message);
      else if (!data)
        setError("Your login is not linked to an official profile yet.");
      else {
        const found = data as Official;
        setOfficial(found);
        const { data: rows, error: originError } = await supabase
          .from("official_weekday_origins")
          .select(
            "official_id,weekday,use_home,alternate_label,alternate_address,alternate_city,alternate_state,alternate_zip,alternate_latitude,alternate_longitude",
          )
          .eq("official_id", found.id)
          .order("weekday");
        if (originError) setError(originError.message);
        const byDay = new Map(
          ((rows || []) as Origin[]).map((row) => [row.weekday, row]),
        );
        setOrigins(
          days.map((_, weekday) => {
            const row = byDay.get(weekday);
            return row
              ? {
                  ...row,
                  alternate_label: row.alternate_label || "",
                  alternate_address: row.alternate_address || "",
                  alternate_city: row.alternate_city || "",
                  alternate_state: row.alternate_state || "",
                  alternate_zip: row.alternate_zip || "",
                }
              : blankOrigin(found.id, weekday, found.home_state || "IA");
          }),
        );
      }
    }
    void load();
  }, [supabase]);
  function set<K extends keyof Official>(key: K, value: Official[K]) {
    setOfficial((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }
  function setOrigin(weekday: number, values: Partial<Origin>) {
    setOrigins((current) =>
      current.map((origin) =>
        origin.weekday === weekday ? { ...origin, ...values } : origin,
      ),
    );
  }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !official || !userId) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile picture must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase(),
      path = `${userId}/profile.${extension}`;
    const { error: upError } = await supabase.storage
      .from("official-profile-pictures")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upError) setError(upError.message);
    else {
      const { data: urlData } = supabase.storage
          .from("official-profile-pictures")
          .getPublicUrl(path),
        url = `${urlData.publicUrl}?v=${Date.now()}`;
      const { error: saveError } = await supabase
        .from("officials")
        .update({ profile_picture_url: url })
        .eq("id", official.id);
      if (saveError) setError(saveError.message);
      else {
        set("profile_picture_url", url);
        setNotice("Profile picture updated.");
      }
    }
    setUploading(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!official) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const homeText = [
        official.home_address,
        official.home_city,
        official.home_state,
        official.home_zip,
      ]
        .filter(Boolean)
        .join(", ");
      const home = homeText
        ? await coordinatesFor(homeText)
        : { latitude: null, longitude: null };
      const prepared = await Promise.all(
        origins.map(async (origin) => {
          if (origin.use_home)
            return {
              ...origin,
              alternate_latitude: null,
              alternate_longitude: null,
            };
          const text = [
            origin.alternate_address,
            origin.alternate_city,
            origin.alternate_state,
            origin.alternate_zip,
          ]
            .filter(Boolean)
            .join(", ");
          if (!text)
            throw new Error(
              `Enter a different starting address for ${days[origin.weekday]}.`,
            );
          const point = await coordinatesFor(text);
          return {
            ...origin,
            alternate_latitude: point.latitude,
            alternate_longitude: point.longitude,
          };
        }),
      );
      const { error: officialError } = await supabase
        .from("officials")
        .update({
          first_name: official.first_name,
          last_name: official.last_name,
          phone: official.phone,
          home_address: official.home_address,
          home_city: official.home_city,
          home_state: official.home_state,
          home_zip: official.home_zip,
          home_latitude: home.latitude,
          home_longitude: home.longitude,
        })
        .eq("id", official.id);
      if (officialError) throw officialError;
      const { error: originError } = await supabase
        .from("official_weekday_origins")
        .upsert(
          prepared.map((origin) => ({
            ...origin,
            alternate_label: origin.alternate_label.trim() || null,
            alternate_address: origin.alternate_address.trim() || null,
            alternate_city: origin.alternate_city.trim() || null,
            alternate_state: origin.alternate_state.trim() || null,
            alternate_zip: origin.alternate_zip.trim() || null,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "official_id,weekday" },
        );
      if (originError) throw originError;
      setOrigins(prepared);
      setOfficial({
        ...official,
        home_latitude: home.latitude,
        home_longitude: home.longitude,
      });
      setNotice("Profile and weekly starting locations updated.");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save profile.");
    }
    setSaving(false);
  }
  const homeLocation = [
    official?.home_address,
    official?.home_city,
    official?.home_state,
    official?.home_zip,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>My Profile</h2>
          <p>Review your contact information and weekly mileage origins.</p>
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      {official && (
        <form className="officialForm" onSubmit={save}>
          <div className="profilePhotoRow">
            <div className="profilePhoto">
              {official.profile_picture_url ? (
                <img
                  src={official.profile_picture_url}
                  alt={`${official.first_name} ${official.last_name}`}
                />
              ) : (
                <span>
                  {(official.first_name?.[0] || "") +
                    (official.last_name?.[0] || "")}
                </span>
              )}
            </div>
            <div>
              <b>Profile Picture</b>
              <p>This photo is visible to officials working your games.</p>
              <label className="secondary profilePhotoButton">
                {uploading
                  ? "Uploading…"
                  : official.profile_picture_url
                    ? "Change Photo"
                    : "Upload Photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={uploadPhoto}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>
          <label>
            First Name
            <input
              value={official.first_name || ""}
              onChange={(e) => set("first_name", e.target.value)}
            />
          </label>
          <label>
            Last Name
            <input
              value={official.last_name || ""}
              onChange={(e) => set("last_name", e.target.value)}
            />
          </label>
          <label>
            Email
            <input value={official.email || ""} disabled />
            <small>Email changes must be made by an administrator.</small>
          </label>
          <label>
            Phone
            <input
              value={official.phone || ""}
              onChange={(e) => set("phone", e.target.value || null)}
            />
          </label>
          <label>
            Home Address
            <input
              value={official.home_address || ""}
              onChange={(e) => set("home_address", e.target.value || null)}
            />
          </label>
          <label>
            City
            <input
              value={official.home_city || ""}
              onChange={(e) => set("home_city", e.target.value || null)}
            />
          </label>
          <label>
            State
            <input
              value={official.home_state || ""}
              onChange={(e) => set("home_state", e.target.value || null)}
            />
          </label>
          <label>
            ZIP
            <input
              value={official.home_zip || ""}
              onChange={(e) => set("home_zip", e.target.value || null)}
            />
          </label>
          <label>
            Certification
            <input value={official.certification_level || ""} disabled />
            <small>Certification is managed by an administrator.</small>
          </label>
          <fieldset className="weekdayOrigins">
            <legend>Weekly Mileage Starting Locations</legend>
            <p>
              Home address is the default. Choose Different Location for days
              you normally leave from work, school, or another address.
            </p>
            <div className="weekdayOriginHeader">
              <b>Day</b>
              <b>Starting Location</b>
              <b>Different Location</b>
            </div>
            {origins.map((origin) => (
              <div className="weekdayOriginRow" key={origin.weekday}>
                <b>{days[origin.weekday]}</b>
                <div>
                  <select
                    value={origin.use_home ? "home" : "alternate"}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        use_home: e.target.value === "home",
                      })
                    }
                  >
                    <option value="home">Home Address</option>
                    <option value="alternate">Different Location</option>
                  </select>
                  <small>
                    {origin.use_home
                      ? homeLocation || "Add home address above"
                      : "Used for games on this day"}
                  </small>
                </div>
                <div className="alternateOriginFields">
                  <input
                    aria-label={`${days[origin.weekday]} location name`}
                    placeholder="Work, school, etc."
                    disabled={origin.use_home}
                    value={origin.alternate_label}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        alternate_label: e.target.value,
                      })
                    }
                  />
                  <input
                    aria-label={`${days[origin.weekday]} street address`}
                    placeholder="Street address"
                    disabled={origin.use_home}
                    value={origin.alternate_address}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        alternate_address: e.target.value,
                      })
                    }
                  />
                  <input
                    aria-label={`${days[origin.weekday]} city`}
                    placeholder="City"
                    disabled={origin.use_home}
                    value={origin.alternate_city}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        alternate_city: e.target.value,
                      })
                    }
                  />
                  <input
                    aria-label={`${days[origin.weekday]} state`}
                    placeholder="State"
                    disabled={origin.use_home}
                    value={origin.alternate_state}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        alternate_state: e.target.value,
                      })
                    }
                  />
                  <input
                    aria-label={`${days[origin.weekday]} ZIP`}
                    placeholder="ZIP"
                    disabled={origin.use_home}
                    value={origin.alternate_zip}
                    onChange={(e) =>
                      setOrigin(origin.weekday, {
                        alternate_zip: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      )}
    </section>
  );
}
