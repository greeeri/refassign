"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import TrainingQuizManager from "./TrainingQuizManager";
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
};
type Member = { official_id: string };
type Module = {
  id: string;
  title: string;
  description: string;
  category: string;
  resource_url: string | null;
  required: boolean;
  active: boolean;
  delivery_type: string;
  registration_url: string | null;
  payment_required: boolean;
  payment_url: string | null;
  instructor_official_id: string | null;
  course_start_at: string | null;
  course_end_at: string | null;
  quiz_id: string | null;
  level_key: string;
  sort_order: number;
};
type Quiz = { id: string; title: string; active: boolean };
type TrainingRegistration = {
  module_id: string;
  status: string;
  payment_status: string;
};
type StoredFile = {
  name: string;
  id: string | null;
  created_at: string | null;
  metadata?: { size?: number } | null;
};
const trainingLibraryCategories = [
  "Laws of the Game",
  "Positioning",
  "Foul Recognition",
  "Assistant Referee",
  "Communication",
  "Game Management",
  "Fitness",
  "Professionalism",
];
const developmentLevels = [
  { key: "u8_referee", label: "U8 Referee" },
  { key: "u10_referee", label: "U10 Referee" },
  { key: "u11_ar", label: "U11 AR" },
  { key: "u12_ar", label: "U12 AR" },
  { key: "u13_referee", label: "U13 Referee" },
];
const localInput = (value: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
const iso = (value: FormDataEntryValue | null) =>
  value ? new Date(String(value)).toISOString() : null;
export default function IowaSoccerDevelopmentAdmin() {
  const supabase = useMemo(() => createClient(), []),
    [programId, setProgramId] = useState(""),
    [officials, setOfficials] = useState<Official[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [modules, setModules] = useState<Module[]>([]),
    [quizzes, setQuizzes] = useState<Quiz[]>([]),
    [registrations, setRegistrations] = useState<TrainingRegistration[]>([]),
    [files, setFiles] = useState<StoredFile[]>([]),
    [selectedOfficial, setSelectedOfficial] = useState(""),
    [deliveryType, setDeliveryType] = useState("self_led"),
    [paymentRequired, setPaymentRequired] = useState(false),
    [editingId, setEditingId] = useState(""),
    [editDeliveryType, setEditDeliveryType] = useState("self_led"),
    [editPaymentRequired, setEditPaymentRequired] = useState(false),
    [activeLevel, setActiveLevel] = useState("u8_referee"),
    [draggedModule, setDraggedModule] = useState(""),
    [pathBusy, setPathBusy] = useState(false),
    [previewPath, setPreviewPath] = useState(false),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [selectedMaterialName, setSelectedMaterialName] = useState(""),
    [attachmentSelections, setAttachmentSelections] = useState<
      Record<string, string>
    >({}),
    [attachingFile, setAttachingFile] = useState(""),
    [uploadError, setUploadError] = useState(""),
    [uploadNotice, setUploadNotice] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function loadFiles() {
    const { data, error: e } = await supabase.storage
      .from("iowa-training-materials")
      .list("materials", {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });
    if (e) setError(e.message);
    else setFiles((data || []) as StoredFile[]);
  }
  async function load() {
    setError("");
    const { data: program, error: pe } = await supabase
      .from("registration_programs")
      .select("id")
      .eq("slug", "iowa-soccer")
      .single();
    if (pe) return setError(pe.message);
    setProgramId(program.id);
    const [o, m, t, r, q] = await Promise.all([
      supabase.rpc("list_development_program_officials", {
        p_program_id: program.id,
      }),
      supabase
        .from("registration_program_officials")
        .select("official_id")
        .eq("program_id", program.id),
      supabase
        .from("development_modules")
        .select(
          "id,title,description,category,resource_url,required,active,delivery_type,registration_url,payment_required,payment_url,instructor_official_id,course_start_at,course_end_at,quiz_id,level_key,sort_order",
        )
        .eq("program_id", program.id)
        .order("sort_order"),
      supabase
        .from("development_training_registrations")
        .select("module_id,status,payment_status"),
      supabase
        .from("training_quizzes")
        .select("id,title,active")
        .eq("program_id", program.id)
        .order("title"),
    ]);
    const e = o.error || m.error || t.error || r.error || q.error;
    if (e) return setError(e.message);
    setOfficials((o.data || []) as Official[]);
    setMembers((m.data || []) as Member[]);
    setModules((t.data || []) as Module[]);
    setRegistrations((r.data || []) as TrainingRegistration[]);
    setQuizzes((q.data || []) as Quiz[]);
    await loadFiles();
  }
  useEffect(() => {
    void load();
  }, []);
  async function addOfficial() {
    if (!selectedOfficial || !programId) return;
    setBusy(true);
    setError("");
    setNotice("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e } = await supabase
      .from("registration_program_officials")
      .insert({
        program_id: programId,
        official_id: selectedOfficial,
        source: "registrar",
        added_by: user?.id || null,
      });
    if (e) setError(e.message);
    else {
      setNotice("Official added to Iowa Soccer Development.");
      setSelectedOfficial("");
      await load();
    }
    setBusy(false);
  }
  async function removeOfficial(id: string) {
    if (
      !window.confirm("Remove this official's Iowa Soccer Development access?")
    )
      return;
    const { error: e } = await supabase
      .from("registration_program_officials")
      .delete()
      .eq("program_id", programId)
      .eq("official_id", id);
    if (e) setError(e.message);
    else await load();
  }
  function modulePayload(form: FormData, type: string, pay: boolean) {
    const scheduled = type !== "self_led";
    return {
      title: form.get("title"),
      level_key: form.get("level_key"),
      category: form.get("category"),
      description: form.get("description") || "",
      resource_url:
        form.get("library_material") || form.get("resource_url") || null,
      quiz_id: form.get("quiz_id") || null,
      required: form.get("required") === "on",
      delivery_type: type,
      registration_url: scheduled ? form.get("registration_url") || null : null,
      payment_required: type === "in_person" && pay,
      payment_url:
        type === "in_person" && pay ? form.get("payment_url") || null : null,
      instructor_official_id: scheduled
        ? form.get("instructor_official_id") || null
        : null,
      course_start_at: scheduled ? iso(form.get("course_start_at")) : null,
      course_end_at: scheduled ? iso(form.get("course_end_at")) : null,
    };
  }
  async function addModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget),
      payload = modulePayload(form, deliveryType, paymentRequired);
    if (deliveryType !== "self_led" && !payload.course_start_at) {
      setError(
        "Date and start time are required for Virtual and In-Person courses.",
      );
      setBusy(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e } = await supabase.from("development_modules").insert({
      ...payload,
      program_id: programId,
      sort_order: modules.length * 10 + 10,
      created_by: user?.id || null,
    });
    if (e) setError(e.message);
    else {
      setNotice("Training module added.");
      event.currentTarget.reset();
      setDeliveryType("self_led");
      setPaymentRequired(false);
      await load();
    }
    setBusy(false);
  }
  async function savePath(updates: { id: string; level_key: string; sort_order: number }[], success: string) {
    setPathBusy(true);
    setError("");
    setNotice("");
    const { error: e } = await supabase.rpc("reorder_development_modules", { p_updates: updates });
    if (e) setError(e.message);
    else { setNotice(success); await load(); }
    setPathBusy(false);
  }
  async function dropModule(beforeId: string | null) {
    if (!draggedModule) return;
    const lane = modules.filter((module) => module.level_key === activeLevel && module.id !== draggedModule);
    const index = beforeId ? lane.findIndex((module) => module.id === beforeId) : lane.length;
    lane.splice(index < 0 ? lane.length : index, 0, modules.find((module) => module.id === draggedModule)!);
    setDraggedModule("");
    await savePath(lane.map((module, position) => ({ id: module.id, level_key: activeLevel, sort_order: (position + 1) * 10 })), "Course order saved.");
  }
  async function moveModule(moduleId: string, levelKey: string) {
    if (!levelKey) return;
    const destination = modules.filter((module) => module.level_key === levelKey),
      nextOrder = destination.length ? Math.max(...destination.map((module) => module.sort_order)) + 10 : 10;
    setActiveLevel(levelKey);
    await savePath([{ id: moduleId, level_key: levelKey, sort_order: nextOrder }], "Module moved to its new level.");
  }
  function beginEdit(m: Module) {
    setEditingId(m.id);
    setEditDeliveryType(m.delivery_type || "self_led");
    setEditPaymentRequired(Boolean(m.payment_required));
    setError("");
    setNotice("");
  }
  async function saveModule(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget),
      payload = modulePayload(form, editDeliveryType, editPaymentRequired);
    if (editDeliveryType !== "self_led" && !payload.course_start_at) {
      setError(
        "Date and start time are required for Virtual and In-Person courses.",
      );
      setBusy(false);
      return;
    }
    const { error: e } = await supabase
      .from("development_modules")
      .update({
        ...payload,
        active: form.get("active") === "on",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (e) setError(e.message);
    else {
      setNotice("Training module updated.");
      setEditingId("");
      await load();
    }
    setBusy(false);
  }
  async function uploadMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      input = form.elements.namedItem("material") as HTMLInputElement,
      file = input.files?.[0];
    setUploadError("");
    setUploadNotice("");
    if (!file) {
      setUploadError("Choose a file before uploading.");
      return;
    }
    if (file.size > 524288000) {
      setUploadError("The selected file is larger than the 500 MB limit.");
      return;
    }
    setUploadBusy(true);
    setUploadNotice(
      `Uploading ${file.name}… Keep this page open${file.size > 10485760 ? "; large files may take a few minutes" : ""}.`,
    );
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `materials/${Date.now()}-${safe}`;
    const { error: e } = await supabase.storage
      .from("iowa-training-materials")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
        upsert: false,
      });
    if (e) {
      setUploadError(e.message);
      setUploadNotice("");
    } else {
      await loadFiles();
      setUploadNotice(
        `${file.name} uploaded successfully. Officials can find it in Iowa Soccer → Training → Training Library → Uploaded Materials.`,
      );
      form.reset();
      setSelectedMaterialName("");
    }
    setUploadBusy(false);
  }
  async function deleteMaterial(name: string) {
    if (!window.confirm("Delete this training material?")) return;
    const { error: e } = await supabase.storage
      .from("iowa-training-materials")
      .remove([`materials/${name}`]);
    if (e) setError(e.message);
    else await loadFiles();
  }
  async function attachMaterial(fileName: string) {
    const moduleId = attachmentSelections[fileName];
    if (!moduleId) {
      setUploadError("Select a training module for this file.");
      return;
    }
    setAttachingFile(fileName);
    setUploadError("");
    setUploadNotice("");
    const { error: e } = await supabase
      .from("development_modules")
      .update({
        resource_url: fileUrl(fileName),
        updated_at: new Date().toISOString(),
      })
      .eq("id", moduleId);
    if (e) setUploadError(e.message);
    else {
      const module = modules.find((item) => item.id === moduleId);
      setUploadNotice(
        `${fileName.replace(/^\d+-/, "")} attached to ${module?.title || "the selected training module"}.`,
      );
      await load();
    }
    setAttachingFile("");
  }
  async function postAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e } = await supabase
      .from("development_announcements")
      .insert({
        program_id: programId,
        title: form.get("title"),
        message: form.get("message"),
        created_by: user?.id || null,
      });
    if (e) setError(e.message);
    else {
      setNotice("Program announcement posted.");
      event.currentTarget.reset();
    }
    setBusy(false);
  }
  const memberIds = new Set(members.map((m) => m.official_id)),
    available = officials.filter((o) => !memberIds.has(o.id)),
    confirmedIds = new Set(
      registrations
        .filter((r) => r.status === "approved" || r.payment_status === "paid")
        .map((r) => r.module_id),
    ),
    unassigned = modules.filter(
      (m) =>
        m.delivery_type !== "self_led" &&
        confirmedIds.has(m.id) &&
        !m.instructor_official_id,
    );
  function fileUrl(name: string) {
    return supabase.storage
      .from("iowa-training-materials")
      .getPublicUrl(`materials/${name}`).data.publicUrl;
  }
  const isLibraryMaterial = (url: string | null) =>
      Boolean(url && files.some((f) => fileUrl(f.name) === url)),
    materialOptions = (selected = "") => (
      <label className="fullSpan">
        Attach Uploaded Material
        <select name="library_material" defaultValue={selected}>
          <option value="">No uploaded material attached</option>
          {files.map((f) => (
            <option key={f.name} value={fileUrl(f.name)}>
              {f.name.replace(/^\d+-/, "")}
            </option>
          ))}
        </select>
        <small>
          Choose a file from the Training Materials Library. This will take
          priority over an external resource link.
        </small>
      </label>
    ),
    deliveryLabel = (d: string) =>
      d === "in_person"
        ? "In Person"
        : d === "virtual"
          ? "Virtual"
          : "Self-Led",
    instructorName = (id: string | null) => {
      const o = officials.find((x) => x.id === id);
      return o ? `${o.first_name} ${o.last_name}` : "Not Assigned";
    },
    schedule = (m: Module) =>
      m.course_start_at
        ? new Date(m.course_start_at).toLocaleString()
        : "Date/Time Not Set";
  const instructorSelect = (name: string, defaultValue = "") => (
    <label>
      Instructor
      <select name={name} defaultValue={defaultValue}>
        <option value="">Not Assigned</option>
        {officials.map((o) => (
          <option key={o.id} value={o.id}>
            {o.first_name} {o.last_name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Iowa Soccer Development Administration</h2>
            <p>
              Add participating officials and manage their training experience.
            </p>
          </div>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        {unassigned.length > 0 && (
          <div className="errorBox">
            <b>Instructor Needed:</b>{" "}
            {unassigned.map((m) => m.title).join(", ")}{" "}
            {unassigned.length === 1 ? "has" : "have"} confirmed registration
            but no instructor assigned.
          </div>
        )}
        <div className="toolbar">
          <label>
            Add Existing Official
            <select
              value={selectedOfficial}
              onChange={(e) => setSelectedOfficial(e.target.value)}
            >
              <option value="">Select an official</option>
              {available.map((o) => (
                <option value={o.id} key={o.id}>
                  {o.last_name}, {o.first_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !selectedOfficial}
            onClick={() => void addOfficial()}
          >
            Add to Program
          </button>
        </div>
      </section>
      <section className="card">
        <div className="courseBuilderHead">
          <div><span className="courseBuilderEyebrow">COURSE PATH BUILDER</span><h2>Build the Referee Journey</h2><p>Choose a level, drag modules into order, or move them to another level.</p></div>
          <button className="secondary" onClick={() => setPreviewPath((value) => !value)}>{previewPath ? "Close Preview" : "Preview Referee Path"}</button>
        </div>
        <div className="courseLevelTabs" role="tablist" aria-label="Development levels">
          {developmentLevels.map((level, index) => {
            const levelModules = modules.filter((module) => module.level_key === level.key);
            return <button type="button" role="tab" aria-selected={activeLevel === level.key} className={activeLevel === level.key ? "active" : ""} onClick={() => setActiveLevel(level.key)} key={level.key}><span>{index + 1}</span><b>{level.label}</b><small>{levelModules.length} module{levelModules.length === 1 ? "" : "s"}</small></button>;
          })}
        </div>
        {previewPath && <div className="coursePathPreview">
          {developmentLevels.map((level, index) => <div key={level.key}><span>{index + 1}</span><b>{level.label}</b><small>{modules.filter((module) => module.level_key === level.key).map((module) => module.title).join(" • ") || "No modules yet"}</small></div>)}
        </div>}
        <div className="courseLane" onDragOver={(event) => event.preventDefault()} onDrop={() => void dropModule(null)}>
          <div className="courseLaneHead"><div><span>LEVEL {developmentLevels.findIndex((level) => level.key === activeLevel) + 1}</span><h3>{developmentLevels.find((level) => level.key === activeLevel)?.label}</h3></div><button className="primary" type="button" onClick={() => document.getElementById("new-training-module")?.scrollIntoView({ behavior: "smooth" })}>+ Add Module</button></div>
          <div className="courseModuleList">
            {modules.filter((module) => module.level_key === activeLevel).map((module, index) => <article draggable={!pathBusy} onDragStart={() => setDraggedModule(module.id)} onDragEnd={() => setDraggedModule("")} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); void dropModule(module.id); }} className={draggedModule === module.id ? "dragging" : ""} key={module.id}>
              <span className="courseDrag" aria-label="Drag to reorder">⋮⋮</span><span className="courseOrder">{index + 1}</span><div><b>{module.title}</b><small>{deliveryLabel(module.delivery_type)} • {module.required ? "Required" : "Optional"} • {module.active ? "Published" : "Draft"}</small></div><label>Move to<select aria-label={`Move ${module.title} to another level`} value="" disabled={pathBusy} onChange={(event) => void moveModule(module.id, event.target.value)}><option value="">Move…</option>{developmentLevels.filter((level) => level.key !== activeLevel).map((level) => <option value={level.key} key={level.key}>{level.label}</option>)}</select></label><button className="secondary" onClick={() => beginEdit(module)}>Edit</button>
            </article>)}
            {!modules.some((module) => module.level_key === activeLevel) && <div className="courseEmpty"><b>No modules in this level</b><span>Add a module or move one here from another level.</span></div>}
          </div>
          <p className="courseDropHint">Drag modules to arrange the order officials will complete them. Changes save automatically.</p>
        </div>
      </section>
      <section className="card" id="new-training-module">
        <h2>Training Content</h2>
        <form className="officialForm" onSubmit={addModule}>
          <label>
            Module Title
            <input name="title" required />
          </label>
          <label>
            Development Level
            <select name="level_key" required value={activeLevel} onChange={(event) => setActiveLevel(event.target.value)}>
              {developmentLevels.map((level) => <option value={level.key} key={level.key}>{level.label}</option>)}
            </select>
          </label>
          <label>
            Training Library Section
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Select a section
              </option>
              {trainingLibraryCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Training Type
            <select
              value={deliveryType}
              onChange={(e) => {
                setDeliveryType(e.target.value);
                if (e.target.value !== "in_person") setPaymentRequired(false);
              }}
            >
              <option value="self_led">Self-Led Course</option>
              <option value="virtual">Virtual Training</option>
              <option value="in_person">In-Person Training</option>
            </select>
          </label>
          {deliveryType !== "self_led" && (
            <>
              {instructorSelect("instructor_official_id")}
              <label>
                Course Date & Start Time
                <input name="course_start_at" type="datetime-local" required />
              </label>
              <label>
                Course End Time
                <input name="course_end_at" type="datetime-local" />
              </label>
            </>
          )}
          <label className="fullSpan">
            Description
            <textarea name="description" required />
          </label>
          {materialOptions()}
          <label className="fullSpan">
            External Video / Resource Link
            <input name="resource_url" type="url" />
          </label>
          <label className="fullSpan">
            Quiz After Video
            <select name="quiz_id" defaultValue="">
              <option value="">No quiz attached</option>
              {quizzes
                .filter((q) => q.active)
                .map((q) => (
                  <option value={q.id} key={q.id}>
                    {q.title}
                  </option>
                ))}
            </select>
            <small>
              Create reusable quizzes in the Quiz Center below, then attach one
              here.
            </small>
          </label>
          {deliveryType !== "self_led" && (
            <label className="fullSpan">
              Registration Link
              <input name="registration_url" type="url" />
            </label>
          )}
          {deliveryType === "in_person" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={paymentRequired}
                  onChange={(e) => setPaymentRequired(e.target.checked)}
                />{" "}
                Payment Required
              </label>
              {paymentRequired && (
                <label className="fullSpan">
                  Payment Link
                  <input name="payment_url" type="url" required />
                </label>
              )}
            </>
          )}
          <label>
            <input name="required" type="checkbox" /> Required Training
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Adding…" : "Add Training Module"}
          </button>
        </form>
        <div className="developmentRoster">
          {modules.map((m) => (
            <div key={m.id} style={{ display: "block" }}>
              {editingId === m.id ? (
                <form
                  className="officialForm"
                  onSubmit={(e) => saveModule(e, m.id)}
                >
                  <label>
                    Module Title
                    <input name="title" defaultValue={m.title} required />
                  </label>
                  <label>
                    Development Level
                    <select name="level_key" defaultValue={m.level_key} required>
                      {developmentLevels.map((level) => <option value={level.key} key={level.key}>{level.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Training Library Section
                    <select name="category" defaultValue={m.category} required>
                      {!trainingLibraryCategories.includes(m.category) && (
                        <option value={m.category}>
                          {m.category} (Current)
                        </option>
                      )}
                      {trainingLibraryCategories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Training Type
                    <select
                      value={editDeliveryType}
                      onChange={(e) => {
                        setEditDeliveryType(e.target.value);
                        if (e.target.value !== "in_person")
                          setEditPaymentRequired(false);
                      }}
                    >
                      <option value="self_led">Self-Led Course</option>
                      <option value="virtual">Virtual Training</option>
                      <option value="in_person">In-Person Training</option>
                    </select>
                  </label>
                  {editDeliveryType !== "self_led" && (
                    <>
                      {instructorSelect(
                        "instructor_official_id",
                        m.instructor_official_id || "",
                      )}
                      <label>
                        Course Date & Start Time
                        <input
                          name="course_start_at"
                          type="datetime-local"
                          defaultValue={localInput(m.course_start_at)}
                          required
                        />
                      </label>
                      <label>
                        Course End Time
                        <input
                          name="course_end_at"
                          type="datetime-local"
                          defaultValue={localInput(m.course_end_at)}
                        />
                      </label>
                    </>
                  )}
                  <label className="fullSpan">
                    Description
                    <textarea
                      name="description"
                      defaultValue={m.description}
                      required
                    />
                  </label>
                  {materialOptions(
                    isLibraryMaterial(m.resource_url)
                      ? m.resource_url || ""
                      : "",
                  )}
                  <label className="fullSpan">
                    External Video / Resource Link
                    <input
                      name="resource_url"
                      type="url"
                      defaultValue={
                        isLibraryMaterial(m.resource_url)
                          ? ""
                          : m.resource_url || ""
                      }
                    />
                  </label>
                  <label className="fullSpan">
                    Quiz After Video
                    <select name="quiz_id" defaultValue={m.quiz_id || ""}>
                      <option value="">No quiz attached</option>
                      {quizzes.map((q) => (
                        <option value={q.id} key={q.id}>
                          {q.title}
                          {q.active ? "" : " (Archived)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editDeliveryType !== "self_led" && (
                    <label className="fullSpan">
                      Registration Link
                      <input
                        name="registration_url"
                        type="url"
                        defaultValue={m.registration_url || ""}
                      />
                    </label>
                  )}
                  {editDeliveryType === "in_person" && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={editPaymentRequired}
                          onChange={(e) =>
                            setEditPaymentRequired(e.target.checked)
                          }
                        />{" "}
                        Payment Required
                      </label>
                      {editPaymentRequired && (
                        <label className="fullSpan">
                          Payment Link
                          <input
                            name="payment_url"
                            type="url"
                            defaultValue={m.payment_url || ""}
                            required
                          />
                        </label>
                      )}
                    </>
                  )}
                  <label>
                    <input
                      name="required"
                      type="checkbox"
                      defaultChecked={m.required}
                    />{" "}
                    Required Training
                  </label>
                  <label>
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={m.active}
                    />{" "}
                    Active / Visible
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="primary" disabled={busy}>
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditingId("")}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span>
                    <b>{m.title}</b>
                    <small>
                      {developmentLevels.find((level) => level.key === m.level_key)?.label || "U8 Referee"} • Training Library: {m.category} •{" "}
                      {deliveryLabel(m.delivery_type)}
                      {m.delivery_type !== "self_led"
                        ? ` • ${schedule(m)} • Instructor: ${instructorName(m.instructor_official_id)}`
                        : ""}
                      {m.payment_required ? " • Payment Required" : ""}
                      {m.quiz_id
                        ? ` • Quiz: ${quizzes.find((q) => q.id === m.quiz_id)?.title || "Attached"}`
                        : ""}
                    </small>
                    {confirmedIds.has(m.id) &&
                      m.delivery_type !== "self_led" &&
                      !m.instructor_official_id && (
                        <small
                          style={{
                            display: "block",
                            fontWeight: 800,
                            color: "#b42318",
                          }}
                        >
                          ⚠ Confirmed registration — instructor required
                        </small>
                      )}
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span className={`badge ${m.active ? "green" : "yellow"}`}>
                      {m.active ? "Active" : "Hidden"}
                    </span>
                    <button className="secondary" onClick={() => beginEdit(m)}>
                      Edit Course
                    </button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {programId && (
        <TrainingQuizManager
          programId={programId}
          onChanged={() => void load()}
        />
      )}
      <section className="card">
        <div className="trainingSectionHead">
          <div>
            <h2>Training Materials Library</h2>
            <p>
              Upload and store PDFs, videos, presentations, documents, and
              images for Iowa Soccer training.
            </p>
          </div>
        </div>
        <form className="trainingAdminUpload" onSubmit={uploadMaterial}>
          <label className="fullSpan">
            Choose Material
            <input
              name="material"
              type="file"
              required
              disabled={uploadBusy}
              accept=".pdf,.mp4,.webm,.png,.jpg,.jpeg,.webp,.pptx,.docx"
              onChange={(e) =>
                setSelectedMaterialName(e.target.files?.[0]?.name || "")
              }
            />
          </label>
          {selectedMaterialName && !uploadBusy && (
            <small className="trainingUploadSelection">
              Ready to upload: <b>{selectedMaterialName}</b>
            </small>
          )}
          <button className="primary" disabled={uploadBusy}>
            {uploadBusy ? "Uploading…" : "Upload Material"}
          </button>
          <small>
            Maximum file size: 500 MB. Keep this page open until the success
            message appears.
          </small>
          {uploadNotice && (
            <div
              className="loginMessage trainingUploadMessage"
              role="status"
              aria-live="polite"
            >
              {uploadNotice}
            </div>
          )}
          {uploadError && (
            <div className="errorBox trainingUploadMessage" role="alert">
              {uploadError}
            </div>
          )}
        </form>
        <p className="trainingLibraryLocation">
          <b>Where files appear:</b> Officials open Iowa Soccer → Training →
          Training Library → Uploaded Materials. Admins can open or delete files
          in the list below.
        </p>
        <div className="trainingAdminFiles">
          {files.length ? (
            files.map((f) => (
              <div key={f.name}>
                <span className="trainingFileIdentity">
                  <b>{f.name.replace(/^\d+-/, "")}</b>
                  <small>
                    {f.metadata?.size
                      ? ` • ${(f.metadata.size / 1024 / 1024).toFixed(1)} MB`
                      : ""}
                  </small>
                </span>
                <div className="trainingFileActions">
                  <label>
                    Attach to Training Module
                    <select
                      value={
                        attachmentSelections[f.name] ??
                        modules.find(
                          (module) => module.resource_url === fileUrl(f.name),
                        )?.id ??
                        ""
                      }
                      onChange={(event) =>
                        setAttachmentSelections((current) => ({
                          ...current,
                          [f.name]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select a module</option>
                      {modules.map((module) => (
                        <option key={module.id} value={module.id}>
                          {module.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={
                      attachingFile === f.name ||
                      !(
                        attachmentSelections[f.name] ??
                        modules.find(
                          (module) => module.resource_url === fileUrl(f.name),
                        )?.id
                      )
                    }
                    onClick={() => void attachMaterial(f.name)}
                  >
                    {attachingFile === f.name ? "Attaching…" : "Attach"}
                  </button>
                  <a
                    className="secondary"
                    href={fileUrl(f.name)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>{" "}
                  <button
                    className="secondary"
                    onClick={() => void deleteMaterial(f.name)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p>No materials uploaded yet.</p>
          )}
        </div>
      </section>
      <section className="card">
        <h2>Post Program Update</h2>
        <form className="officialForm" onSubmit={postAnnouncement}>
          <label>
            Title
            <input name="title" required />
          </label>
          <label className="fullSpan">
            Message
            <textarea name="message" required />
          </label>
          <button className="primary" disabled={busy}>
            Post Announcement
          </button>
        </form>
      </section>
    </>
  );
}
