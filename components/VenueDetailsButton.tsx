"use client";

import { useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Venue = {
  location_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  directions: string | null;
  parking_instructions: string | null;
  entrance_information: string | null;
  map_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};

export default function VenueDetailsButton({ gameId }: { gameId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function show() {
    setOpen(true);
    if (venue) return;
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .rpc("get_my_venue_details", { p_game_id: gameId })
      .maybeSingle();
    if (loadError) setError(loadError.message);
    else if (!data) setError("Venue details are not available for this game.");
    else setVenue(data as Venue);
    setLoading(false);
  }

  const address = venue
    ? [venue.address, venue.city, venue.state].filter(Boolean).join(", ")
    : "";
  const mapUrl =
    venue?.map_url ||
    (address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : "");

  return (
    <>
      <button className="tableButton" type="button" onClick={() => void show()}>
        Venue Details
      </button>
      {open && (
        <div className="venueModalBackdrop" onClick={() => setOpen(false)}>
          <section
            className="card venueModal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="venueModalClose"
              type="button"
              aria-label="Close venue details"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <h2>{venue?.location_name || "Venue Details"}</h2>
            {loading && <p>Loading venue details…</p>}
            {error && <div className="errorBox">{error}</div>}
            {venue && (
              <div className="venueDetailList">
                <div>
                  <b>Address</b>
                  <p>{address || "Not provided"}</p>
                  {mapUrl && (
                    <a
                      className="tableButton"
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Map
                    </a>
                  )}
                </div>
                <div>
                  <b>Field Directions</b>
                  <p>
                    {venue.directions || "No additional directions provided."}
                  </p>
                </div>
                <div>
                  <b>Parking</b>
                  <p>
                    {venue.parking_instructions ||
                      "No parking instructions provided."}
                  </p>
                </div>
                <div>
                  <b>Entrance</b>
                  <p>
                    {venue.entrance_information ||
                      "No entrance information provided."}
                  </p>
                </div>
                <div>
                  <b>Venue Contact</b>
                  <p>{venue.contact_name || "No contact provided."}</p>
                  <div className="venueContactActions">
                    {venue.contact_phone && (
                      <a
                        className="tableButton"
                        href={`tel:${venue.contact_phone}`}
                      >
                        Call
                      </a>
                    )}
                    {venue.contact_phone && (
                      <a
                        className="tableButton"
                        href={`sms:${venue.contact_phone}`}
                      >
                        Text
                      </a>
                    )}
                    {venue.contact_email && (
                      <a
                        className="tableButton"
                        href={`mailto:${venue.contact_email}`}
                      >
                        Email
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
