"use client";
import CrewProfileLink from "./CrewProfileLink";
import { crewPositionLabel, orderedCrew } from "../lib/crewDisplay";

export type OfficialCrewMember = {
  position_id: string;
  position: string | null;
  sort_order?: number;
  assignment_id: string | null;
  name: string | null;
  phone?: string | null;
  email?: string | null;
  profile_picture_url?: string | null;
  status: string;
};

export function crewStatus(status?: string | null) {
  const value = (status || "open").toLowerCase();
  if (value === "confirmed") return { label: "Confirmed", tone: "green" };
  if (value === "accepted") return { label: "Accepted", tone: "green" };
  if (value === "proposed") return { label: "Needs Response", tone: "yellow" };
  return { label: "Open", tone: "blue" };
}

export default function OfficialCrewList({ crew, contacts = false }: { crew: OfficialCrewMember[]; contacts?: boolean }) {
  return (
    <div className={contacts ? "crewContactList" : "officialCrewList"}>
      {orderedCrew(crew).map((member) => {
        const current = crewStatus(member.status);
        return (
          <div key={member.assignment_id || member.position_id} className="officialCrewMember">
            <div>
              <b>{crewPositionLabel(member.position)}</b>
              {member.name ? <CrewProfileLink member={{ ...member, name: member.name }} /> : <span>Unassigned</span>}
            </div>
            <div className="officialCrewMemberActions">
              <span className={`badge ${current.tone}`}>{current.label}</span>
              {contacts && member.name && member.phone && <a aria-label={`Call ${member.name}`} href={`tel:${member.phone}`}>Call</a>}
              {contacts && member.name && member.email && <a aria-label={`Email ${member.name}`} href={`mailto:${member.email}`}>Email</a>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
