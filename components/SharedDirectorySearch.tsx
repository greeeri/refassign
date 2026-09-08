"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

export type SharedDirectoryEntity = "league" | "level" | "team" | "official";

type DirectoryResult = {
  id: string;
  name: string;
  detail: string | null;
  already_connected: boolean;
};

const copy: Record<
  SharedDirectoryEntity,
  { title: string; placeholder: string }
> = {
  league: { title: "Search shared leagues", placeholder: "League name" },
  level: { title: "Search shared levels", placeholder: "Level name" },
  team: { title: "Search shared teams", placeholder: "Team, sport, or level" },
  official: {
    title: "Search shared officials",
    placeholder: "Official name or email",
  },
};

export default function SharedDirectorySearch({
  organizationId,
  entity,
  onConnected,
}: {
  organizationId: string;
  entity: SharedDirectoryEntity;
  onConnected: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [connectingId, setConnectingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError("Enter at least two characters.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const { data, error: searchError } = await supabase.rpc(
      "search_shared_directory",
      {
        p_organization_id: organizationId,
        p_entity: entity,
        p_query: query.trim(),
      },
    );
    setBusy(false);
    if (searchError) setError(searchError.message);
    else setResults((data || []) as DirectoryResult[]);
  }

  async function connect(result: DirectoryResult) {
    setConnectingId(result.id);
    setError("");
    const { error: connectError } = await supabase.rpc(
      "connect_shared_directory_record",
      {
        p_organization_id: organizationId,
        p_entity: entity,
        p_record_id: result.id,
      },
    );
    setConnectingId("");
    if (connectError) {
      setError(connectError.message);
      return;
    }
    setResults((current) =>
      current.map((item) =>
        item.id === result.id ? { ...item, already_connected: true } : item,
      ),
    );
    setMessage(`${result.name} is now available to this organization.`);
    await onConnected();
  }

  return (
    <div className="directoryConnectCard">
      <div>
        <p className="eyebrow">Shared directory</p>
        <h3>{copy[entity].title}</h3>
        <p>Reuse an existing record before creating another one.</p>
      </div>
      <form className="directoryConnectForm" onSubmit={search}>
        <label>
          Search
          <input
            value={query}
            placeholder={copy[entity].placeholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="secondary" disabled={busy}>
          {busy ? "Searching…" : "Search directory"}
        </button>
      </form>
      {error && <div className="errorBox">{error}</div>}
      {message && <div className="successBox">{message}</div>}
      {results.length > 0 && (
        <div className="directoryResults compactResults">
          {results.map((result) => (
            <article key={result.id}>
              <div>
                <strong>{result.name}</strong>
                {result.detail && <span>{result.detail}</span>}
              </div>
              <button
                type="button"
                className="primary"
                disabled={
                  result.already_connected || connectingId === result.id
                }
                onClick={() => void connect(result)}
              >
                {result.already_connected
                  ? "Already connected"
                  : connectingId === result.id
                    ? "Connecting…"
                    : "Use this record"}
              </button>
            </article>
          ))}
        </div>
      )}
      {!busy && query.trim().length >= 2 && results.length === 0 && !error && (
        <p>No matching shared records. You can create a new one below.</p>
      )}
    </div>
  );
}
