"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "../lib/supabase/client";
import OfficialCcContact from "./OfficialCcContact";
import OfficialsRosterManager from "./OfficialsRosterManager";
import CommunicationCenter from "./CommunicationCenter";
import SharedDirectorySearch from "./SharedDirectorySearch";

type Official = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  home_area: string | null;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  sports: string[];
  certification_level: string | null;
  active: boolean;
  date_of_birth: string | null;
  is_minor: boolean;
  gender: string | null;
  ethnicity: string | null;
  secondary_email: string | null;
  address_unit: string | null;
  country: string | null;
  mobile_phone: string | null;
  license: string | null;
  license_status: string | null;
  license_issue_date: string | null;
  license_expiration_date: string | null;
  license_issuer: string | null;
  curriculum: string | null;
  background_screening: string | null;
  background_screening_expiration_date: string | null;
  safesport: string | null;
  safesport_expiration_date: string | null;
  intro_player_safety: string | null;
  intro_player_safety_expiration_date: string | null;
  safe_soccer: string | null;
  safe_soccer_expiration_date: string | null;
  provisional_status: string | null;
  referee_years_experience: number | null;
};

type PositionRank = {
  official_id: string;
  rank: number;
  ref_rank: number;
  ar1_rank: number;
  ar2_rank: number;
  fourth_rank: number;
  mentor_certified: boolean;
};

type Choice = { id: string; name: string };

type OfficialForm = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  home_area: string;
  home_address: string;
  home_city: string;
  home_state: string;
  home_zip: string;
  sports: string[];
  certification_level: string;
  rank: string;
  ref_rank: string;
  ar1_rank: string;
  ar2_rank: string;
  fourth_rank: string;
  mentor_certified: boolean;
  league_ids: string[];
  level_ids: string[];
  date_of_birth: string;
  is_minor: boolean;
  gender: string;
  ethnicity: string;
  secondary_email: string;
  address_unit: string;
  country: string;
  mobile_phone: string;
  license: string;
  license_status: string;
  license_issue_date: string;
  license_expiration_date: string;
  license_issuer: string;
  curriculum: string;
  background_screening: string;
  background_screening_expiration_date: string;
  safesport: string;
  safesport_expiration_date: string;
  intro_player_safety: string;
  intro_player_safety_expiration_date: string;
  safe_soccer: string;
  safe_soccer_expiration_date: string;
  provisional_status: string;
  referee_years_experience: string;
};

const SPORTS = [
  "Soccer",
  "Football",
  "Basketball",
  "Baseball",
  "Softball",
  "Volleyball",
  "Wrestling",
  "Track & Field",
  "Other",
];

function newForm(): OfficialForm {
  return {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    home_area: "",
    home_address: "",
    home_city: "",
    home_state: "IA",
    home_zip: "",
    sports: ["Soccer"],
    certification_level: "",
    rank: "1.0",
    ref_rank: "1.0",
    ar1_rank: "1.0",
    ar2_rank: "1.0",
    fourth_rank: "1.0",
    mentor_certified: false,
    league_ids: [],
    level_ids: [],
    date_of_birth: "",
    is_minor: false,
    gender: "",
    ethnicity: "",
    secondary_email: "",
    address_unit: "",
    country: "United States",
    mobile_phone: "",
    license: "",
    license_status: "",
    license_issue_date: "",
    license_expiration_date: "",
    license_issuer: "",
    curriculum: "",
    background_screening: "",
    background_screening_expiration_date: "",
    safesport: "",
    safesport_expiration_date: "",
    intro_player_safety: "",
    intro_player_safety_expiration_date: "",
    safe_soccer: "",
    safe_soccer_expiration_date: "",
    provisional_status: "",
    referee_years_experience: "",
  };
}

type LinkOfficialResult = {
  email: string;
  existing_account: boolean;
  found?: boolean;
  display_name?: string;
  already_connected?: boolean;
  valid?: boolean;
  first_name?: string;
  last_name?: string;
};

export default function OfficialsDirectory({
  organizationId,
  focusOfficialId,
}: {
  organizationId?: string;
  focusOfficialId?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const handledReportFocus = useRef("");
  const [officials, setOfficials] = useState<Official[]>([]);
  const [positionRanks, setPositionRanks] = useState<
    Record<string, PositionRank>
  >({});
  const [leagues, setLeagues] = useState<Choice[]>([]);
  const [levels, setLevels] = useState<Choice[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showCommunications, setShowCommunications] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rankMessage, setRankMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sportFilter, setSportFilter] = useState("All");
  const [form, setForm] = useState<OfficialForm>(newForm());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [officialEmail, setOfficialEmail] = useState("");
  const [officialFirstName, setOfficialFirstName] = useState("");
  const [officialLastName, setOfficialLastName] = useState("");
  const [linkingOfficial, setLinkingOfficial] = useState(false);
  const [linkMessage, setLinkMessage] = useState("");
  const [officialMatch, setOfficialMatch] = useState<LinkOfficialResult | null>(
    null,
  );
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkEmailText, setBulkEmailText] = useState("");
  const [bulkResults, setBulkResults] = useState<LinkOfficialResult[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingInvitationEmails, setPendingInvitationEmails] = useState<
    string[]
  >([]);
  const [sendingInvitationEmail, setSendingInvitationEmail] = useState("");

  function parsedBulkRows() {
    const lines = bulkEmailText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map((cell) =>
      cell
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .toLowerCase(),
    );
    const emailColumn = header.findIndex(
      (cell) => cell === "email" || cell === "email_address",
    );
    const firstNameColumn = header.findIndex(
      (cell) =>
        cell === "first_name" || cell === "firstname" || cell === "first name",
    );
    const lastNameColumn = header.findIndex(
      (cell) =>
        cell === "last_name" || cell === "lastname" || cell === "last name",
    );
    if (emailColumn >= 0)
      return lines
        .slice(1)
        .map((line) => {
          const cells = line
            .split(",")
            .map((cell) => cell.trim().replace(/^['"]|['"]$/g, ""));
          return {
            email: cells[emailColumn] || "",
            first_name:
              firstNameColumn >= 0 ? cells[firstNameColumn] || "" : "",
            last_name: lastNameColumn >= 0 ? cells[lastNameColumn] || "" : "",
          };
        })
        .filter((row) => Boolean(row.email));
    return bulkEmailText
      .split(/[\s,;]+/)
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean)
      .map((email) => ({ email, first_name: "", last_name: "" }));
  }

  async function previewBulkOfficials() {
    if (!organizationId) return;
    const rows = parsedBulkRows();
    const emails = rows.map((row) => row.email);
    if (!emails.length)
      return setError("Paste email addresses or choose a CSV file first.");
    setBulkBusy(true);
    setError("");
    setLinkMessage("");
    const { data, error: bulkError } = await supabase.rpc(
      "bulk_search_organization_official_emails",
      { p_organization_id: organizationId, p_emails: emails },
    );
    setBulkBusy(false);
    if (bulkError) setError(bulkError.message);
    else
      setBulkResults(
        ((data || []) as LinkOfficialResult[]).map((item) => {
          const row = rows.find(
            (candidate) =>
              candidate.email.toLowerCase() === item.email.toLowerCase(),
          );
          return {
            ...item,
            first_name: row?.first_name || "",
            last_name: row?.last_name || "",
          };
        }),
      );
  }

  async function addBulkOfficials() {
    if (!organizationId) return;
    const emails = bulkResults
      .filter((item) => item.valid !== false && !item.already_connected)
      .map((item) => item.email);
    if (!emails.length) return;
    setBulkBusy(true);
    setError("");
    const { data, error: bulkError } = await supabase.rpc(
      "bulk_add_organization_official_emails",
      { p_organization_id: organizationId, p_emails: emails },
    );
    setBulkBusy(false);
    if (bulkError) return setError(bulkError.message);
    const added = (data || []) as LinkOfficialResult[];
    for (const item of bulkResults) {
      if (!item.first_name || !item.last_name || item.already_connected)
        continue;
      const { error: nameError } = await supabase.rpc(
        "set_organization_official_name",
        {
          p_organization_id: organizationId,
          p_email: item.email,
          p_first_name: item.first_name,
          p_last_name: item.last_name,
        },
      );
      if (nameError) return setError(nameError.message);
    }
    const invitationEmails = added
      .filter((item) => !item.existing_account)
      .map((item) => item.email);
    let sent = 0;
    if (invitationEmails.length) {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch("/api/tier-test/official-invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
        },
        body: JSON.stringify({ organizationId, emails: invitationEmails }),
      });
      const notification = (await response.json().catch(() => ({}))) as {
        sent?: number;
        error?: string;
      };
      sent = notification.sent || 0;
      if (!response.ok) {
        setError(
          notification.error ||
            "The officials were added, but invitation emails could not be sent.",
        );
      }
    }
    setBulkResults([]);
    setBulkEmailText("");
    setLinkMessage(
      `${added.length} officials added.${invitationEmails.length ? ` ${sent} invitation emails sent to missing accounts.` : " All already had RefAssign accounts."}`,
    );
    await load();
  }

  async function readBulkFile(file?: File) {
    if (!file) return;
    setBulkEmailText(await file.text());
    setBulkResults([]);
  }

  async function searchOfficialByEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!organizationId || !officialEmail.trim()) return;
    setLinkingOfficial(true);
    setError("");
    setLinkMessage("");
    setOfficialMatch(null);
    const { data, error: linkError } = await supabase.rpc(
      "search_organization_official_email",
      { p_organization_id: organizationId, p_email: officialEmail.trim() },
    );
    setLinkingOfficial(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }
    setOfficialMatch(data as LinkOfficialResult);
  }

  async function connectOfficial() {
    if (!organizationId || !officialMatch) return;
    setLinkingOfficial(true);
    setError("");
    if (officialMatch.already_connected && !officialMatch.existing_account) {
      const sent = await sendOfficialInvitation(officialMatch.email);
      setLinkingOfficial(false);
      if (sent)
        setLinkMessage(
          `A new secure invitation was sent to ${officialMatch.email}.`,
        );
      return;
    }
    const { data, error: linkError } = await supabase.rpc(
      "add_organization_official_by_email",
      { p_organization_id: organizationId, p_email: officialMatch.email },
    );
    setLinkingOfficial(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }
    const result = data as LinkOfficialResult;
    if (
      !officialMatch.found &&
      officialFirstName.trim() &&
      officialLastName.trim()
    ) {
      const { error: nameError } = await supabase.rpc(
        "set_organization_official_name",
        {
          p_organization_id: organizationId,
          p_email: officialMatch.email,
          p_first_name: officialFirstName.trim(),
          p_last_name: officialLastName.trim(),
        },
      );
      if (nameError) {
        setLinkingOfficial(false);
        return setError(nameError.message);
      }
    }
    if (!result.existing_account) {
      const sent = await sendOfficialInvitation(result.email);
      if (!sent) {
        setLinkingOfficial(false);
        return;
      }
    }
    setOfficialEmail("");
    setOfficialFirstName("");
    setOfficialLastName("");
    setOfficialMatch(null);
    setLinkMessage(
      result.existing_account
        ? `${result.email} was connected to this organization.`
        : `${result.email} was added and a secure invitation was sent.`,
    );
    await load();
  }

  async function sendOfficialInvitation(email: string) {
    if (!organizationId) return false;
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/tier-test/official-invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
      },
      body: JSON.stringify({ organizationId, emails: [email] }),
    });
    const notification = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      setError(notification.error || "The invitation email could not be sent.");
      return false;
    }
    return true;
  }

  async function resendDirectoryInvitation(email: string) {
    setSendingInvitationEmail(email);
    setError("");
    setLinkMessage("");
    const sent = await sendOfficialInvitation(email);
    setSendingInvitationEmail("");
    if (sent) setLinkMessage(`A new secure invitation was sent to ${email}.`);
  }

  async function load() {
    setLoading(true);
    setError("");
    const loadAllOfficials = async () => {
      const data: Official[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const request = organizationId
          ? supabase
              .rpc("get_organization_official_directory", {
                p_organization_id: organizationId,
              })
              .range(from, from + pageSize - 1)
          : supabase
              .from("officials")
              .select(
                "id,first_name,last_name,email,phone,home_area,home_address,home_city,home_state,home_zip,sports,certification_level,active,date_of_birth,is_minor,gender,ethnicity,secondary_email,address_unit,country,mobile_phone,license,license_status,license_issue_date,license_expiration_date,license_issuer,curriculum,background_screening,background_screening_expiration_date,safesport,safesport_expiration_date,intro_player_safety,intro_player_safety_expiration_date,safe_soccer,safe_soccer_expiration_date,provisional_status,referee_years_experience",
              )
              .order("last_name")
              .order("first_name")
              .range(from, from + pageSize - 1);
        const page = await request;
        if (page.error) return { data: null, error: page.error };
        const rows = (page.data || []) as Official[];
        data.push(...rows);
        if (rows.length < pageSize) break;
      }
      return { data, error: null };
    };
    const [o, lg, lv] = await Promise.all([
      loadAllOfficials(),
      supabase
        .from("leagues")
        .select("id,name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("levels")
        .select("id,name")
        .eq("active", true)
        .order("name"),
    ]);
    if (o.error) {
      setError(o.error.message);
      setLoading(false);
      return;
    }
    setOfficials((o.data || []) as Official[]);
    setLeagues((lg.data || []) as Choice[]);
    setLevels((lv.data || []) as Choice[]);
    if (organizationId) {
      const { data: invitations, error: invitationError } = await supabase
        .from("organization_official_invitations")
        .select("email")
        .eq("organization_id", organizationId)
        .eq("status", "pending");
      if (invitationError) setError(invitationError.message);
      else
        setPendingInvitationEmails(
          (invitations || []).map((item) => item.email.toLowerCase()),
        );
    } else setPendingInvitationEmails([]);

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();
      const allowed =
        Boolean(organizationId) ||
        ["admin", "assignor"].includes(profile?.role || "");
      setCanManage(allowed);
      if (allowed) {
        const { data: pr, error: rankError } = await supabase
          .from("my_assignment_rankings")
          .select(
            "official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_certified",
          );
        if (rankError) setError(rankError.message);
        const map: Record<string, PositionRank> = {};
        for (const row of (pr || []) as PositionRank[]) {
          map[row.official_id] = {
            official_id: row.official_id,
            rank: Number(row.rank),
            ref_rank: Number(row.ref_rank),
            ar1_rank: Number(row.ar1_rank),
            ar2_rank: Number(row.ar2_rank),
            fourth_rank: Number(row.fourth_rank),
            mentor_certified: Boolean(row.mentor_certified),
          };
        }
        setPositionRanks(map);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);
  useEffect(() => {
    if (!focusOfficialId || handledReportFocus.current === focusOfficialId)
      return;
    const official = officials.find((item) => item.id === focusOfficialId);
    if (!official) return;
    handledReportFocus.current = focusOfficialId;
    setShowRoster(false);
    setShowCommunications(false);
    setQuery(`${official.first_name} ${official.last_name}`);
    void startEdit(official).then(() => {
      window.setTimeout(
        () =>
          document
            .getElementById("focused-official-form")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
    });
  }, [focusOfficialId, officials]);

  function toggleSport(sport: string) {
    setForm((current) => ({
      ...current,
      sports: current.sports.includes(sport)
        ? current.sports.filter((x) => x !== sport)
        : [...current.sports, sport],
    }));
  }

  function toggleChoice(field: "league_ids" | "level_ids", id: string) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((x) => x !== id)
        : [...current[field], id],
    }));
  }

  function toggleAllChoices(
    field: "league_ids" | "level_ids",
    choices: Choice[],
  ) {
    setForm((current) => {
      const allIds = choices.map((choice) => choice.id);
      const allSelected =
        allIds.length > 0 && allIds.every((id) => current[field].includes(id));
      return { ...current, [field]: allSelected ? [] : allIds };
    });
  }

  function startAdd() {
    setRankMessage("");
    setEditingId(null);
    setForm(newForm());
    setShowForm(true);
    setError("");
  }

  async function startEdit(o: Official) {
    setRankMessage("");
    setEditingId(o.id);
    const [lg, lv] = await Promise.all([
      supabase
        .from("official_league_eligibility")
        .select("league_id")
        .eq("official_id", o.id),
      supabase
        .from("official_level_eligibility")
        .select("level_id")
        .eq("official_id", o.id),
    ]);
    const pr = positionRanks[o.id];
    setForm({
      first_name: o.first_name,
      last_name: o.last_name,
      email: o.email || "",
      phone: o.phone || "",
      home_area: o.home_area || "",
      home_address: o.home_address || "",
      home_city: o.home_city || "",
      home_state: o.home_state || "IA",
      home_zip: o.home_zip || "",
      sports: o.sports,
      certification_level: o.certification_level || "",
      rank: (pr?.rank ?? 1).toFixed(1),
      ref_rank: (pr?.ref_rank ?? 1).toFixed(1),
      ar1_rank: (pr?.ar1_rank ?? 1).toFixed(1),
      ar2_rank: (pr?.ar2_rank ?? 1).toFixed(1),
      fourth_rank: (pr?.fourth_rank ?? 1).toFixed(1),
      mentor_certified: pr?.mentor_certified ?? false,
      league_ids: (lg.data || []).map((x) => x.league_id),
      level_ids: (lv.data || []).map((x) => x.level_id),
      date_of_birth: o.date_of_birth || "",
      is_minor: o.is_minor,
      gender: o.gender || "",
      ethnicity: o.ethnicity || "",
      secondary_email: o.secondary_email || "",
      address_unit: o.address_unit || "",
      country: o.country || "",
      mobile_phone: o.mobile_phone || "",
      license: o.license || "",
      license_status: o.license_status || "",
      license_issue_date: o.license_issue_date || "",
      license_expiration_date: o.license_expiration_date || "",
      license_issuer: o.license_issuer || "",
      curriculum: o.curriculum || "",
      background_screening: o.background_screening || "",
      background_screening_expiration_date:
        o.background_screening_expiration_date || "",
      safesport: o.safesport || "",
      safesport_expiration_date: o.safesport_expiration_date || "",
      intro_player_safety: o.intro_player_safety || "",
      intro_player_safety_expiration_date:
        o.intro_player_safety_expiration_date || "",
      safe_soccer: o.safe_soccer || "",
      safe_soccer_expiration_date: o.safe_soccer_expiration_date || "",
      provisional_status: o.provisional_status || "",
      referee_years_experience:
        o.referee_years_experience == null
          ? ""
          : String(o.referee_years_experience),
    });
    setShowForm(true);
    setError("");
  }

  async function saveOnlyMyRankings() {
    if (!editingId || !canManage || saving) return;
    const values = [
      form.rank,
      form.ref_rank,
      form.ar1_rank,
      form.ar2_rank,
      form.fourth_rank,
    ].map((value) => Math.round(Number(value) * 10) / 10);
    if (
      values.some((value) => !Number.isFinite(value) || value < 1 || value > 10)
    ) {
      setError("All rankings must be between 1.0 and 10.0.");
      return;
    }
    setSaving(true);
    setError("");
    setRankMessage("");
    try {
      const [rank, ref_rank, ar1_rank, ar2_rank, fourth_rank] = values;
      const { error: saveError } = await supabase.rpc(
        "set_my_official_assessment",
        {
          p_official_id: editingId,
          p_rank: rank,
          p_ref_rank: ref_rank,
          p_ar1_rank: ar1_rank,
          p_ar2_rank: ar2_rank,
          p_fourth_rank: fourth_rank,
          p_mentor_certified: form.mentor_certified,
        },
      );
      if (saveError) throw saveError;
      setPositionRanks((current) => ({
        ...current,
        [editingId]: {
          official_id: editingId,
          rank,
          ref_rank,
          ar1_rank,
          ar2_rank,
          fourth_rank,
          mentor_certified: form.mentor_certified,
        },
      }));
      setRankMessage("Your rankings and the mentor certification were saved.");
    } catch (saveError) {
      setError(
        saveError && typeof saveError === "object" && "message" in saveError
          ? String(saveError.message)
          : "Your rankings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveOfficial(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.sports.length) {
      setError("Select at least one sport.");
      return;
    }
    const rankValues = [
      form.rank,
      form.ref_rank,
      form.ar1_rank,
      form.ar2_rank,
      form.fourth_rank,
    ].map((v) => Math.round(Number(v) * 10) / 10);
    if (rankValues.some((v) => !Number.isFinite(v) || v < 1 || v > 10)) {
      setError("All position ranks must be between 1.0 and 10.0.");
      return;
    }

    setSaving(true);
    setError("");
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      home_area: form.home_area.trim() || null,
      home_address: form.home_address.trim() || null,
      home_city: form.home_city.trim() || null,
      home_state: form.home_state.trim() || null,
      home_zip: form.home_zip.trim() || null,
      sports: form.sports,
      certification_level: form.certification_level.trim() || null,
      date_of_birth: form.date_of_birth || null,
      is_minor: form.is_minor,
      gender: form.gender.trim() || null,
      ethnicity: form.ethnicity.trim() || null,
      secondary_email: form.secondary_email.trim() || null,
      address_unit: form.address_unit.trim() || null,
      country: form.country.trim() || null,
      mobile_phone: form.mobile_phone.trim() || null,
      license: form.license.trim() || null,
      license_status: form.license_status.trim() || null,
      license_issue_date: form.license_issue_date || null,
      license_expiration_date: form.license_expiration_date || null,
      license_issuer: form.license_issuer.trim() || null,
      curriculum: form.curriculum.trim() || null,
      background_screening: form.background_screening.trim() || null,
      background_screening_expiration_date:
        form.background_screening_expiration_date || null,
      safesport: form.safesport.trim() || null,
      safesport_expiration_date: form.safesport_expiration_date || null,
      intro_player_safety: form.intro_player_safety.trim() || null,
      intro_player_safety_expiration_date:
        form.intro_player_safety_expiration_date || null,
      safe_soccer: form.safe_soccer.trim() || null,
      safe_soccer_expiration_date: form.safe_soccer_expiration_date || null,
      provisional_status: form.provisional_status.trim() || null,
      referee_years_experience:
        form.referee_years_experience === ""
          ? null
          : Number(form.referee_years_experience),
    };

    let officialId = editingId;
    if (officialId) {
      const result = await supabase
        .from("officials")
        .update(payload)
        .eq("id", officialId);
      if (result.error) {
        setSaving(false);
        setError(result.error.message);
        return;
      }
    } else {
      const result = await supabase
        .from("officials")
        .insert(payload)
        .select("id")
        .single();
      if (result.error) {
        setSaving(false);
        setError(result.error.message);
        return;
      }
      officialId = result.data.id;
    }

    if (canManage && officialId) {
      const [rank, ref_rank, ar1_rank, ar2_rank, fourth_rank] = rankValues;
      const rankResult = await supabase.rpc("set_my_official_assessment", {
        p_official_id: officialId,
        p_rank: rank,
        p_ref_rank: ref_rank,
        p_ar1_rank: ar1_rank,
        p_ar2_rank: ar2_rank,
        p_fourth_rank: fourth_rank,
        p_mentor_certified: form.mentor_certified,
      });
      if (rankResult.error) {
        setSaving(false);
        setError(rankResult.error.message);
        return;
      }

      await Promise.all([
        supabase
          .from("official_league_eligibility")
          .delete()
          .eq("official_id", officialId),
        supabase
          .from("official_level_eligibility")
          .delete()
          .eq("official_id", officialId),
      ]);
      if (form.league_ids.length)
        await supabase.from("official_league_eligibility").insert(
          form.league_ids.map((league_id) => ({
            official_id: officialId!,
            league_id,
          })),
        );
      if (form.level_ids.length)
        await supabase.from("official_level_eligibility").insert(
          form.level_ids.map((level_id) => ({
            official_id: officialId!,
            level_id,
          })),
        );
    }

    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    setForm(newForm());
    await load();
  }

  async function toggleActive(o: Official) {
    const { error: updateError } = await supabase
      .from("officials")
      .update({ active: !o.active })
      .eq("id", o.id);
    if (updateError) setError(updateError.message);
    else await load();
  }

  const visible = officials.filter((o) => {
    const q = query.toLowerCase().trim();
    const matchesSearch =
      !q ||
      `${o.first_name} ${o.last_name} ${o.email || ""} ${o.phone || ""}`
        .toLowerCase()
        .includes(q);
    return (
      matchesSearch && (sportFilter === "All" || o.sports.includes(sportFilter))
    );
  });

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function toggleAllVisible() {
    const ids = visible.filter((o) => !!o.email || !!o.phone).map((o) => o.id);
    const allSelected =
      ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current, ...ids])),
    );
  }

  function emailSelected() {
    const emails = officials
      .filter((o) => selectedIds.includes(o.id) && o.email)
      .map((o) => o.email as string);
    if (!emails.length) {
      setError("Select at least one official with an email address.");
      return;
    }
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}`;
  }

  function textSelected() {
    const phones = officials
      .filter((o) => selectedIds.includes(o.id) && o.phone)
      .map((o) => o.phone as string);
    if (!phones.length) {
      setError("Select at least one official with a phone number.");
      return;
    }
    window.location.href = `sms:${phones.join(",")}`;
  }

  function rankInput(
    key: "rank" | "ref_rank" | "ar1_rank" | "ar2_rank" | "fourth_rank",
    label: string,
  ) {
    return (
      <label>
        {label}
        <input
          type="number"
          min="1"
          max="10"
          step="0.1"
          required
          value={form[key]}
          disabled={saving}
          onChange={(e) => {
            setRankMessage("");
            setForm((current) => ({ ...current, [key]: e.target.value }));
          }}
        />
      </label>
    );
  }

  const allLeaguesSelected =
    leagues.length > 0 && leagues.every((x) => form.league_ids.includes(x.id));
  const allLevelsSelected =
    levels.length > 0 && levels.every((x) => form.level_ids.includes(x.id));

  return (
    <>
      {canManage && (
        <div className="actionbar">
          <div>
            <h2>Officials</h2>
            <p>Add individually or manage the entire roster with CSV.</p>
          </div>
          <div className="headerActions">
            <button
              className={showCommunications ? "primary" : "secondary"}
              onClick={() => {
                setShowCommunications(!showCommunications);
                setShowRoster(false);
                setShowForm(false);
              }}
            >
              {showCommunications
                ? "Back to Official Directory"
                : "Communications"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowRoster(!showRoster);
                setShowCommunications(false);
                setShowForm(false);
              }}
            >
              {showRoster ? "Close Roster Manager" : "Roster Import / Export"}
            </button>
          </div>
        </div>
      )}
      {organizationId && (
        <section className="card directoryConnectCard">
          <SharedDirectorySearch
            organizationId={organizationId}
            entity="official"
            onConnected={load}
          />
          <div>
            <p className="eyebrow">Official email search</p>
            <h2>Find an existing official or send an invitation</h2>
            <p>
              Existing officials are connected to this organization. New
              officials are created once and prepared for invitation.
            </p>
          </div>
          <form
            className="directoryConnectForm"
            onSubmit={searchOfficialByEmail}
          >
            <label>
              Search by email address
              <input
                type="email"
                required
                placeholder="official@example.com"
                value={officialEmail}
                onChange={(event) => setOfficialEmail(event.target.value)}
              />
            </label>
            <button className="primary" disabled={linkingOfficial}>
              {linkingOfficial ? "Searching…" : "Search email"}
            </button>
          </form>
          {officialMatch && (
            <div className="directoryResults">
              <article>
                <div>
                  <strong>
                    {officialMatch.display_name || officialMatch.email}
                  </strong>
                  <span>
                    {officialMatch.found
                      ? `${officialMatch.email} — Existing RefAssign account found`
                      : `${officialMatch.email} — No account yet; an invitation will be prepared`}
                  </span>
                </div>
                {!officialMatch.found && (
                  <div className="formGrid">
                    <label>
                      First name
                      <input
                        required
                        value={officialFirstName}
                        onChange={(event) =>
                          setOfficialFirstName(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Last name
                      <input
                        required
                        value={officialLastName}
                        onChange={(event) =>
                          setOfficialLastName(event.target.value)
                        }
                      />
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={
                    (officialMatch.already_connected &&
                      officialMatch.existing_account) ||
                    linkingOfficial ||
                    (!officialMatch.found &&
                      (!officialFirstName.trim() || !officialLastName.trim()))
                  }
                  onClick={() => void connectOfficial()}
                >
                  {officialMatch.already_connected
                    ? officialMatch.existing_account
                      ? "Already in organization"
                      : "Resend secure invitation"
                    : officialMatch.found
                      ? "Add to organization"
                      : "Add and prepare invitation"}
                </button>
              </article>
            </div>
          )}
          {linkMessage && <div className="successBox">{linkMessage}</div>}
          <button
            type="button"
            className="secondary bulkToggle"
            onClick={() => setShowBulkAdd((open) => !open)}
          >
            {showBulkAdd ? "Close bulk upload" : "Bulk add officials"}
          </button>
          {showBulkAdd && (
            <div className="bulkOfficialPanel">
              <h3>Bulk search and add</h3>
              <p>
                Upload a CSV with <b>first_name</b>, <b>last_name</b>, and{" "}
                <b>email</b> columns, or paste up to 500 email addresses. Names
                from the CSV are saved in the directory; pasted-email names are
                completed when each official creates their account.
              </p>
              <label className="filePicker">
                Choose CSV file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(event) =>
                    void readBulkFile(event.target.files?.[0])
                  }
                />
              </label>
              <label>
                Email addresses
                <textarea
                  rows={6}
                  value={bulkEmailText}
                  placeholder="official1@example.com&#10;official2@example.com"
                  onChange={(event) => {
                    setBulkEmailText(event.target.value);
                    setBulkResults([]);
                  }}
                />
              </label>
              <button
                type="button"
                className="primary"
                disabled={bulkBusy}
                onClick={() => void previewBulkOfficials()}
              >
                {bulkBusy ? "Checking…" : "Review email matches"}
              </button>
              {bulkResults.length > 0 && (
                <>
                  <div className="bulkSummary">
                    <b>
                      {bulkResults.filter((item) => item.found).length} existing
                      accounts
                    </b>
                    <b>
                      {
                        bulkResults.filter(
                          (item) => item.valid !== false && !item.found,
                        ).length
                      }{" "}
                      invitations needed
                    </b>
                    <b>
                      {
                        bulkResults.filter((item) => item.valid === false)
                          .length
                      }{" "}
                      invalid
                    </b>
                  </div>
                  <div className="directoryResults compactResults">
                    {bulkResults.map((item) => (
                      <article key={item.email}>
                        <div>
                          <strong>
                            {item.first_name && item.last_name
                              ? `${item.first_name} ${item.last_name}`
                              : item.display_name &&
                                  item.display_name !== item.email
                                ? item.display_name
                                : "Name pending"}
                          </strong>
                          <span>
                            {item.valid === false
                              ? "Invalid email"
                              : item.already_connected
                                ? "Already in organization"
                                : item.found
                                  ? "Existing RefAssign account"
                                  : "New invitation required"}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      bulkBusy ||
                      !bulkResults.some(
                        (item) =>
                          item.valid !== false && !item.already_connected,
                      )
                    }
                    onClick={() => void addBulkOfficials()}
                  >
                    {bulkBusy
                      ? "Adding…"
                      : "Add officials and email invitations"}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {showRoster && <OfficialsRosterManager organizationId={organizationId} />}
      {showCommunications ? (
        <CommunicationCenter organizationId={organizationId} />
      ) : (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Officials Directory</h2>
              <p>{officials.length} officials</p>
            </div>
            <div className="headerActions">
              {canManage && (
                <>
                  <button
                    className="secondary"
                    disabled={!selectedIds.length}
                    onClick={emailSelected}
                  >
                    Email Selected
                    {selectedIds.length ? ` (${selectedIds.length})` : ""}
                  </button>
                  <button
                    className="secondary"
                    disabled={!selectedIds.length}
                    onClick={textSelected}
                  >
                    Text Selected
                    {selectedIds.length ? ` (${selectedIds.length})` : ""}
                  </button>
                </>
              )}
              <button
                className="primary"
                onClick={showForm ? () => setShowForm(false) : startAdd}
              >
                {showForm ? "Cancel" : "+ Add Official"}
              </button>
            </div>
          </div>
          <div className="toolbar">
            <input
              placeholder="Search roster by name, email, or phone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
            >
              <option>All</option>
              {SPORTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {showForm && (
            <form
              id="focused-official-form"
              className={
                focusOfficialId === editingId
                  ? "officialForm reportActionFocus"
                  : "officialForm"
              }
              onSubmit={saveOfficial}
            >
              <label>
                First name
                <input
                  required
                  value={form.first_name}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      first_name: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Last name
                <input
                  required
                  value={form.last_name}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      last_name: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      email: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Phone
                <input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      phone: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Home Address
                <input
                  value={form.home_address}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      home_address: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Home City
                <input
                  value={form.home_city}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      home_city: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Home State
                <input
                  value={form.home_state}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      home_state: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Home ZIP
                <input
                  value={form.home_zip}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      home_zip: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Certification
                <input
                  value={form.certification_level}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      certification_level: e.target.value,
                    }))
                  }
                />
              </label>
              <fieldset style={{ gridColumn: "1 / -1" }}>
                <legend>Referee Profile &amp; Compliance</legend>
                <div className="officialForm">
                  <label>
                    USSF-ID
                    <input
                      value={editingId || "Assigned when saved"}
                      disabled
                    />
                  </label>
                  <label>
                    DOB
                    <input
                      type="date"
                      value={form.date_of_birth}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          date_of_birth: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={form.is_minor}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, is_minor: e.target.checked }))
                      }
                    />{" "}
                    Is a minor
                  </label>
                  <label>
                    Gender
                    <input
                      value={form.gender}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, gender: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Ethnicity
                    <input
                      value={form.ethnicity}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, ethnicity: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Secondary Email
                    <input
                      type="email"
                      value={form.secondary_email}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          secondary_email: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Apt/Suite/Unit
                    <input
                      value={form.address_unit}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, address_unit: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Country
                    <input
                      value={form.country}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, country: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Mobile Phone
                    <input
                      value={form.mobile_phone}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, mobile_phone: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    License
                    <input
                      value={form.license}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, license: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Status
                    <input
                      value={form.license_status}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          license_status: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Issue Date
                    <input
                      type="date"
                      value={form.license_issue_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          license_issue_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Expiration Date
                    <input
                      type="date"
                      value={form.license_expiration_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          license_expiration_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Issuer
                    <input
                      value={form.license_issuer}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          license_issuer: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Curriculum
                    <input
                      value={form.curriculum}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, curriculum: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Background Screening
                    <input
                      value={form.background_screening}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          background_screening: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Background Screening Expiration Date
                    <input
                      type="date"
                      value={form.background_screening_expiration_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          background_screening_expiration_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    SafeSport
                    <input
                      value={form.safesport}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, safesport: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    SafeSport Expiration Date
                    <input
                      type="date"
                      value={form.safesport_expiration_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          safesport_expiration_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Intro to Player Safety
                    <input
                      value={form.intro_player_safety}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          intro_player_safety: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Intro to Player Safety Expiration Date
                    <input
                      type="date"
                      value={form.intro_player_safety_expiration_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          intro_player_safety_expiration_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Safe Soccer
                    <input
                      value={form.safe_soccer}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, safe_soccer: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Safe Soccer Expiration Date
                    <input
                      type="date"
                      value={form.safe_soccer_expiration_date}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          safe_soccer_expiration_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Provisional Status
                    <input
                      value={form.provisional_status}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          provisional_status: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Referee Years Experience
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.referee_years_experience}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          referee_years_experience: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Sports</legend>
                <div className="sportChecks">
                  {SPORTS.map((s) => (
                    <label key={s}>
                      <input
                        type="checkbox"
                        checked={form.sports.includes(s)}
                        onChange={() => toggleSport(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              {canManage && (
                <>
                  <p style={{ gridColumn: "1 / -1" }}>
                    Performance rankings are private to your assignor account.
                    Mentor certification is shared on the official’s record.
                  </p>
                  {rankInput("rank", "My General Rank")}
                  {rankInput("ref_rank", "My REF Rank")}
                  {rankInput("ar1_rank", "My AR1 Rank")}
                  {rankInput("ar2_rank", "My AR2 Rank")}
                  {rankInput("fourth_rank", "My 4th Rank")}
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={form.mentor_certified}
                      disabled={saving}
                      onChange={(event) => {
                        setRankMessage("");
                        setForm((current) => ({
                          ...current,
                          mentor_certified: event.target.checked,
                        }));
                      }}
                    />
                    Mentor certified
                  </label>
                  {editingId && (
                    <div>
                      <button
                        type="button"
                        className="secondary"
                        disabled={saving}
                        onClick={() => void saveOnlyMyRankings()}
                      >
                        {saving ? "Saving…" : "Save Rankings & Certification"}
                      </button>
                      {rankMessage && <p role="status">{rankMessage}</p>}
                    </div>
                  )}
                  <fieldset>
                    <legend>Eligible Leagues</legend>
                    <div className="sportChecks">
                      <label>
                        <input
                          type="checkbox"
                          checked={allLeaguesSelected}
                          onChange={() =>
                            toggleAllChoices("league_ids", leagues)
                          }
                        />
                        <b>
                          {allLeaguesSelected
                            ? "Clear All Leagues"
                            : "Select All Leagues"}
                        </b>
                      </label>
                      {leagues.map((x) => (
                        <label key={x.id}>
                          <input
                            type="checkbox"
                            checked={form.league_ids.includes(x.id)}
                            onChange={() => toggleChoice("league_ids", x.id)}
                          />
                          {x.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Eligible Levels</legend>
                    <div className="sportChecks">
                      <label>
                        <input
                          type="checkbox"
                          checked={allLevelsSelected}
                          onChange={() => toggleAllChoices("level_ids", levels)}
                        />
                        <b>
                          {allLevelsSelected
                            ? "Clear All Levels"
                            : "Select All Levels"}
                        </b>
                      </label>
                      {levels.map((x) => (
                        <label key={x.id}>
                          <input
                            type="checkbox"
                            checked={form.level_ids.includes(x.id)}
                            onChange={() => toggleChoice("level_ids", x.id)}
                          />
                          {x.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <div className="formActions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Save Changes"
                      : "Save Official"}
                </button>
              </div>
            </form>
          )}
          {showForm && editingId && (
            <OfficialCcContact key={editingId} officialId={editingId} />
          )}
          {error && <div className="errorBox">{error}</div>}
          {loading ? (
            <p>Loading officials…</p>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    {canManage && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select visible officials"
                          checked={
                            visible.filter((o) => o.email || o.phone).length >
                              0 &&
                            visible
                              .filter((o) => o.email || o.phone)
                              .every((o) => selectedIds.includes(o.id))
                          }
                          onChange={toggleAllVisible}
                        />
                      </th>
                    )}
                    <th>Official</th>
                    <th>Sports</th>
                    <th>Home</th>
                    {canManage && (
                      <>
                        <th>My General</th>
                        <th>My Ref</th>
                        <th>My AR1</th>
                        <th>My AR2</th>
                        <th>My 4th</th>
                        <th>Mentor Certified</th>
                      </>
                    )}
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => {
                    const pr = positionRanks[o.id];
                    return (
                      <tr key={o.id}>
                        {canManage && (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${o.first_name} ${o.last_name}`}
                              checked={selectedIds.includes(o.id)}
                              disabled={!o.email && !o.phone}
                              onChange={() => toggleSelected(o.id)}
                            />
                          </td>
                        )}
                        <td>
                          <b>
                            {o.first_name} {o.last_name}
                          </b>
                          <small>{o.email || "No email"}</small>
                          <small>{o.phone || "No phone"}</small>
                        </td>
                        <td>{o.sports.join(", ")}</td>
                        <td>
                          {[o.home_city, o.home_state]
                            .filter(Boolean)
                            .join(", ") ||
                            o.home_area ||
                            "—"}
                        </td>
                        {canManage && (
                          <>
                            <td>
                              <b>{(pr?.rank ?? 1).toFixed(1)}</b>
                            </td>
                            <td>
                              <b>{(pr?.ref_rank ?? 1).toFixed(1)}</b>
                            </td>
                            <td>
                              <b>{(pr?.ar1_rank ?? 1).toFixed(1)}</b>
                            </td>
                            <td>
                              <b>{(pr?.ar2_rank ?? 1).toFixed(1)}</b>
                            </td>
                            <td>
                              <b>{(pr?.fourth_rank ?? 1).toFixed(1)}</b>
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={pr?.mentor_certified ?? false}
                                disabled
                                aria-label={`Mentor certification for ${o.first_name} ${o.last_name}`}
                                style={{ width: "auto" }}
                              />
                            </td>
                          </>
                        )}
                        <td>
                          <span
                            className={o.active ? "badge green" : "badge red"}
                          >
                            {o.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          {organizationId && o.email && (
                            <button
                              className="tableButton"
                              disabled={sendingInvitationEmail === o.email}
                              onClick={() =>
                                void resendDirectoryInvitation(o.email!)
                              }
                            >
                              {sendingInvitationEmail === o.email
                                ? "Sending…"
                                : pendingInvitationEmails.includes(
                                      o.email.toLowerCase(),
                                    )
                                  ? "Resend invitation"
                                  : "Send invitation"}
                            </button>
                          )}{" "}
                          <button
                            className="tableButton"
                            onClick={() => void startEdit(o)}
                          >
                            Edit
                          </button>{" "}
                          <button
                            className="tableButton"
                            onClick={() => void toggleActive(o)}
                          >
                            {o.active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
