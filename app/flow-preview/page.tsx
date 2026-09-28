"use client";

import { useState } from "react";
import styles from "./page.module.css";

type Official = { name: string; response: string; eligible: boolean };
type Slot = { position: string; official: Official | null };
type Game = { id: string; field: string; time: string; status: string; slots: Slot[]; archived?: boolean };

const initialGames: Game[] = [
  { id: "410", field: "Green 1", time: "Saturday, Oct 3 · 10:00 AM", status: "Active", slots: [
    { position: "REF", official: { name: "Jordan Lee", response: "Accepted", eligible: true } },
    { position: "AR1", official: { name: "Avery Kim", response: "Accepted", eligible: true } },
    { position: "AR2", official: { name: "Casey Morgan", response: "Awaiting response", eligible: true } },
  ] },
  { id: "411", field: "Green 2", time: "Saturday, Oct 3 · 10:00 AM", status: "Active", slots: [
    { position: "REF", official: null },
    { position: "AR1", official: { name: "Taylor Reed", response: "Accepted", eligible: true } },
    { position: "AR2", official: null },
  ] },
  { id: "412", field: "Green 3", time: "Saturday, Oct 3 · 10:00 AM", status: "Active", slots: [
    { position: "REF", official: { name: "Riley Park", response: "Accepted", eligible: false } },
    { position: "AR1", official: null },
    { position: "AR2", official: null },
  ] },
  { id: "413", field: "Blue 1", time: "Saturday, Oct 3 · 11:30 AM", status: "Canceled", slots: [
    { position: "REF", official: { name: "Sam Rivera", response: "Accepted", eligible: true } },
    { position: "AR1", official: null },
  ] },
];

const sections = ["Game cards", "Transfer or Switch", "Check-in", "Archive"] as const;
type Section = (typeof sections)[number];

export default function FlowPreview() {
  const [section, setSection] = useState<Section>("Game cards");
  const [games, setGames] = useState<Game[]>(initialGames);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<string | null>(null);
  const [source, setSource] = useState("410:REF");
  const [mode, setMode] = useState<"transfer" | "switch">("transfer");
  const [target, setTarget] = useState("411:REF");
  const [decision, setDecision] = useState<"notify" | "accept">("notify");
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const sourceGame = games.find((game) => game.id === source.split(":")[0]);
  const sourceSlot = sourceGame?.slots.find((slot) => slot.position === source.split(":")[1]);
  const targetGame = games.find((game) => game.id === target.split(":")[0]);
  const targetSlot = targetGame?.slots.find((slot) => slot.position === target.split(":")[1]);
  const targetOptions = games.filter((game) => game.status === "Active" && game.id !== sourceGame?.id && game.time === sourceGame?.time && game.field.startsWith("Green"))
    .flatMap((game) => game.slots.filter((slot) => mode === "switch" || !slot.official).map((slot) => ({ game, slot })));
  const conflict = targetSlot?.official && !targetSlot.official.eligible ? `${targetSlot.official.name} needs an eligibility override for the source game.` : "";

  function changeMode(next: "transfer" | "switch") {
    setMode(next);
    setTarget(next === "transfer" ? "411:REF" : "411:AR1");
    setNotice("");
  }

  function applyMove() {
    if (!sourceGame || !sourceSlot?.official || !targetGame || !targetSlot) return;
    if (mode === "transfer" && targetSlot.official) return;
    if (conflict) { setNotice("Resolve the eligibility conflict before applying this switch."); return; }
    const outgoing = sourceSlot.official;
    const incoming = targetSlot.official;
    const response = decision === "accept" ? "Accepted" : "Awaiting response";
    setGames((current) => current.map((game) => ({ ...game, slots: game.slots.map((slot) => {
      if (game.id === sourceGame.id && slot.position === sourceSlot.position) return { ...slot, official: incoming ? { ...incoming, response } : null };
      if (game.id === targetGame.id && slot.position === targetSlot.position) return { ...slot, official: { ...outgoing, response } };
      return slot;
    }) })));
    setSource(`${targetGame.id}:${targetSlot.position}`);
    setTarget(`${sourceGame.id}:${sourceSlot.position}`);
    setNotice(`${mode === "switch" ? "Switch" : "Transfer"} applied in this walkthrough. ${decision === "notify" ? "The moved official would receive an acceptance request." : "The move is marked accepted."} Other crew positions stay on their games.`);
  }

  function reset() {
    setGames(initialGames); setChecked([]); setNotice(""); setShowArchived(false);
    setSource("410:REF"); setMode("transfer"); setTarget("411:REF"); setDecision("notify");
    setPreview(null); setSchedule(null); setExpanded(null);
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>REF PRO GROUP · ASSIGN CENTER</span><h1>Assignment process walkthrough</h1><p>Try the game, official, and field move flows with sample data.</p></div>
        <button className={styles.reset} onClick={reset}>Reset sample data</button>
      </header>
      <div className={styles.sample}>Interactive example · no real assignments, notifications, or payroll records are changed</div>
      <nav className={styles.nav} aria-label="Walkthrough steps">{sections.map((item, index) => <button key={item} className={section === item ? styles.active : ""} onClick={() => { setSection(item); setNotice(""); }}><span>{index + 1}</span>{item}</button>)}</nav>

      {section === "Game cards" && <section className={styles.panel}>
        <div className={styles.heading}><div><h2>Collapsed games and crew preview</h2><p>Hover over Crew on desktop or tap Crew on a phone. Open a game to see its slots and the Schedule links.</p></div></div>
        <div className={styles.grid}>{games.filter((game) => game.status === "Active").map((game) => <article className={styles.game} key={game.id}>
          <div className={styles.gameTop}><span>GAME #{game.id}</span><span className={styles.badge}>{game.status}</span></div>
          <h3>{game.field}</h3><p>{game.time}</p>
          <div className={styles.gameActions}><button onClick={() => setExpanded(expanded === game.id ? null : game.id)} aria-expanded={expanded === game.id}>{expanded === game.id ? "Collapse details" : "Open details"}</button><button onClick={() => setPreview(preview === game.id ? null : game.id)} aria-expanded={preview === game.id} onMouseEnter={() => setPreview(game.id)} onMouseLeave={() => setPreview((current) => current === game.id ? null : current)}>Crew preview</button></div>
          {(preview === game.id || expanded === game.id) && <div className={styles.slots}>{game.slots.map((slot) => <div className={styles.slot} key={slot.position}><strong>{slot.position}</strong><span>{slot.official?.name || "Open"}<small>{slot.official?.response || "Unassigned"}</small></span>{expanded === game.id && slot.official && <button className={styles.link} onClick={() => setSchedule(slot.official!.name)}>Schedule</button>}</div>)}</div>}
        </article>)}</div>
      </section>}

      {section === "Transfer or Switch" && <section className={styles.panel}>
        <div className={styles.heading}><div><h2>Move an official within the field complex</h2><p>Green 1, Green 2, and Green 3 have the exact same start time. Other games are excluded.</p></div></div>
        <div className={styles.flow}><div className={styles.controls}>
          <label>Official and current position<select value={source} onChange={(event) => { setSource(event.target.value); setTarget("411:REF"); setMode("transfer"); setNotice(""); }}>{games.filter((game) => game.status === "Active").flatMap((game) => game.slots.filter((slot) => slot.official).map((slot) => <option key={`${game.id}:${slot.position}`} value={`${game.id}:${slot.position}`}>{slot.official!.name} · {game.field} · {slot.position}</option>))}</select></label>
          <div><span className={styles.label}>Move type</span><div className={styles.segment}><button className={mode === "transfer" ? styles.selected : ""} onClick={() => changeMode("transfer")}>Transfer to open slot</button><button className={mode === "switch" ? styles.selected : ""} onClick={() => changeMode("switch")}>Switch with a slot</button></div></div>
          <label>Destination game and position<select value={target} onChange={(event) => { setTarget(event.target.value); setNotice(""); }}>{targetOptions.map(({ game, slot }) => <option key={`${game.id}:${slot.position}`} value={`${game.id}:${slot.position}`}>#{game.id} · {game.field} · {slot.position} · {slot.official?.name || "Open"}</option>)}</select></label>
          <label>After the move<select value={decision} onChange={(event) => setDecision(event.target.value as "notify" | "accept")}><option value="notify">Assign and notify for acceptance</option><option value="accept">Accept the move now</option></select></label>
          <button className={styles.primary} onClick={applyMove} disabled={!sourceSlot?.official || !targetSlot || Boolean(conflict)}>Confirm {mode}</button>
        </div><aside className={styles.review}>
          <span className={styles.eyebrow}>REVIEW BEFORE CONFIRMING</span><h3>{mode === "transfer" ? "Transfer" : "Switch"} summary</h3>
          <div className={styles.route}><div><small>FROM</small><strong>{sourceGame?.field} · {sourceSlot?.position}</strong><span>{sourceSlot?.official?.name || "Select an official"}</span></div><div className={styles.arrow}>→</div><div><small>TO</small><strong>{targetGame?.field} · {targetSlot?.position}</strong><span>{targetSlot?.official?.name || "Open position"}</span></div></div>
          <ul><li>Same start time: <b>Yes</b></li><li>Same field complex: <b>Yes</b></li><li>Other crew positions: <b>Preserved</b></li><li>Next response: <b>{decision === "notify" ? "Awaiting acceptance" : "Accepted"}</b></li></ul>
          {conflict ? <div className={styles.warning}>{conflict} Choose another slot for this example.</div> : <div className={styles.success}>No sample schedule or eligibility conflict found.</div>}
          {notice && <div className={styles.notice} role="status">{notice}</div>}
        </aside></div>
      </section>}

      {section === "Check-in" && <section className={styles.panel}>
        <div className={styles.heading}><div><h2>Event official check-in</h2><p>Officials are listed individually. Each official’s games stay together and are ordered by start time, then field.</p></div></div>
        <div className={styles.list}>{Array.from(new Set(games.filter((game) => !game.archived).flatMap((game) => game.slots.map((slot) => slot.official?.name).filter(Boolean)))).sort().map((name) => <label className={styles.checkRow} key={name}><input type="checkbox" checked={checked.includes(name!)} onChange={() => setChecked((current) => current.includes(name!) ? current.filter((item) => item !== name) : [...current, name!])}/><span><strong>{name}</strong>{games.filter((game) => !game.archived && game.slots.some((slot) => slot.official?.name === name)).sort((a,b) => a.time.localeCompare(b.time) || a.field.localeCompare(b.field)).map((game) => <small key={game.id}>#{game.id} · {game.time} · {game.field}</small>)}</span><b>{checked.includes(name!) ? "Checked in" : "Not checked in"}</b></label>)}</div>
      </section>}

      {section === "Archive" && <section className={styles.panel}>
        <div className={styles.heading}><div><h2>Archive canceled games</h2><p>Remove canceled games from the working assignment view while retaining their historical details.</p></div></div>
        <div className={styles.segment}><button className={!showArchived ? styles.selected : ""} onClick={() => setShowArchived(false)}>Working schedule</button><button className={showArchived ? styles.selected : ""} onClick={() => setShowArchived(true)}>Archived games</button></div>
        <div className={styles.list}>{games.filter((game) => Boolean(game.archived) === showArchived).map((game) => <div className={styles.archiveRow} key={game.id}><div><strong>#{game.id} · {game.field}</strong><small>{game.time} · {game.status} · {game.slots.filter((slot) => slot.official).length} assigned</small>{showArchived && <small>Crew: {game.slots.filter((slot) => slot.official).map((slot) => `${slot.position} ${slot.official!.name}`).join(" · ") || "None"}</small>}</div>{game.status === "Canceled" && <button onClick={() => setGames((current) => current.map((item) => item.id === game.id ? { ...item, archived: !showArchived } : item))}>{showArchived ? "Restore" : "Archive canceled game"}</button>}</div>)}</div>
      </section>}
      <footer className={styles.footer}><span>Sample process preview for RefAssign PR #39</span><a href="https://github.com/greeeri/refassign/pull/39">Review the implementation</a></footer>
    </div>
    {schedule && <div className={styles.overlay} onClick={() => setSchedule(null)}><div className={styles.modal} role="dialog" aria-modal="true" aria-label={`${schedule} schedule`} onClick={(event) => event.stopPropagation()}><button className={styles.close} onClick={() => setSchedule(null)}>Close</button><span className={styles.eyebrow}>OFFICIAL SCHEDULE</span><h2>{schedule}</h2><p>Assigned games in this sample:</p>{games.filter((game) => game.slots.some((slot) => slot.official?.name === schedule)).map((game) => <div className={styles.scheduleItem} key={game.id}><b>#{game.id} · {game.field}</b><span>{game.time} · {game.slots.find((slot) => slot.official?.name === schedule)?.position}</span></div>)}</div></div>}
  </main>;
}
