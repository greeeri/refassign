"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type UndoOperation = {
  id: string;
  description: string;
  created_at: string;
  expires_at: string;
};

export function announceUndoAvailable() {
  window.dispatchEvent(new Event("refassign:undo-available"));
}

export default function UndoCenter() {
  const supabase = useMemo(() => createClient(), []),
    [operation, setOperation] = useState<UndoOperation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("latest_undo_operation");
    setOperation(((data || [])[0] as UndoOperation | undefined) || null);
  }, [supabase]);
  useEffect(() => {
    void load();
    window.addEventListener("refassign:undo-available", load);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.removeEventListener("refassign:undo-available", load);
      window.clearInterval(timer);
    };
  }, [load]);
  async function undo() {
    if (!operation || busy) return;
    setBusy(true);
    setError("");
    const { error: undoError } = await supabase.rpc("undo_operation", {
      p_operation_id: operation.id,
    });
    if (undoError) {
      setError(undoError.message);
      setBusy(false);
      return;
    }
    setOperation(null);
    window.setTimeout(() => window.location.reload(), 350);
  }
  if (!operation && !error) return null;
  return (
    <div role="status" style={{position:"fixed",right:20,bottom:20,zIndex:1000,maxWidth:390,padding:"12px 14px",borderRadius:10,background:"#172033",color:"#fff",boxShadow:"0 12px 35px rgba(15,23,42,.3)",display:"flex",alignItems:"center",gap:12}}>
      <div style={{ flex: 1 }}>
        <b>{error || operation?.description}</b>
        {!error && <small style={{display:"block",color:"#cbd5e1"}}>Undo is available for 15 minutes.</small>}
      </div>
      {operation && <button type="button" disabled={busy} onClick={() => void undo()} style={{background:"#facc15",color:"#172033",border:0,borderRadius:7,padding:"8px 13px",fontWeight:900,cursor:"pointer"}}>{busy ? "Undoing…" : "Undo"}</button>}
    </div>
  );
}
