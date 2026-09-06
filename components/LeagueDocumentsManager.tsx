"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type DocumentType = "policy" | "form" | "guide" | "other";
type LeagueDocument = {
  id: string;
  league_id: string;
  title: string;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number;
  created_at: string;
};

const typeLabels: Record<DocumentType, string> = {
  policy: "Policy",
  form: "Form",
  guide: "Guide",
  other: "Other",
};
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LeagueDocumentsManager({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<LeagueDocument[]>([]);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("policy");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDocuments() {
    const { data, error: loadError } = await supabase
      .from("league_documents")
      .select("id,league_id,title,document_type,file_name,storage_path,mime_type,file_size,created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setDocuments((data || []) as LeagueDocument[]);
  }

  useEffect(() => {
    void loadDocuments();
  }, [leagueId]);

  async function uploadDocument(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!file) {
      setError("Choose a document to upload.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Documents must be 20 MB or smaller.");
      return;
    }
    setBusy(true);
    const storagePath = `${leagueId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("league-documents")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }
    const { error: insertError } = await supabase.from("league_documents").insert({
      league_id: leagueId,
      title: title.trim(),
      document_type: documentType,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      file_size: file.size,
    });
    if (insertError) {
      await supabase.storage.from("league-documents").remove([storagePath]);
      setError(insertError.message);
    } else {
      setTitle("");
      setDocumentType("policy");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setNotice("Document added.");
      await loadDocuments();
    }
    setBusy(false);
  }

  async function downloadDocument(document: LeagueDocument) {
    setError("");
    const { data, error: downloadError } = await supabase.storage
      .from("league-documents")
      .download(document.storage_path);
    if (downloadError) {
      setError(downloadError.message);
      return;
    }
    const url = URL.createObjectURL(data);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.file_name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function removeDocument(document: LeagueDocument) {
    if (!confirm(`Remove “${document.title}”?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { error: storageError } = await supabase.storage.from("league-documents").remove([document.storage_path]);
    if (storageError) setError(storageError.message);
    else {
      const { error: deleteError } = await supabase.from("league_documents").delete().eq("id", document.id);
      if (deleteError) setError(deleteError.message);
      else {
        setNotice("Document removed.");
        await loadDocuments();
      }
    }
    setBusy(false);
  }

  return (
    <div className="leagueDocumentsPanel">
      <div className="leagueDocumentsHead">
        <div>
          <h3>Documents &amp; Policies</h3>
          <p>Add rules, policies, forms, or guides for {leagueName}.</p>
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      <form className="leagueDocumentForm" onSubmit={uploadDocument}>
        <label>
          Document Title
          <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: 2026 Competition Rules" />
        </label>
        <label>
          Type
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="leagueDocumentFile">
          File
          <input ref={fileInput} required type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <small>Maximum file size: 20 MB</small>
        </label>
        <button className="primary" disabled={busy}>{busy ? "Uploading…" : "Add Document"}</button>
      </form>
      {documents.length === 0 ? <p className="leagueDocumentsEmpty">No documents have been added for this league.</p> : (
        <div className="leagueDocumentList">
          {documents.map((document) => (
            <div className="leagueDocumentRow" key={document.id}>
              <div className="leagueDocumentIcon" aria-hidden="true">▤</div>
              <div className="leagueDocumentDetails">
                <b>{document.title}</b>
                <small>{typeLabels[document.document_type]} • {document.file_name} • {formatSize(document.file_size)} • Added {new Date(document.created_at).toLocaleDateString()}</small>
              </div>
              <div className="leagueDocumentActions">
                <button className="secondary" type="button" onClick={() => void downloadDocument(document)}>Download</button>
                <button className="tableButton" type="button" disabled={busy} onClick={() => void removeDocument(document)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
