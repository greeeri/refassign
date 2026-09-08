"use client";

import { useEffect, useMemo, useState } from "react";

type MileagePlan = "one_way" | "round_trip" | "actual" | "none";
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
  home_latitude: number | null;
  home_longitude: number | null;
};
type Origin = {
  official_id: string;
  weekday: number;
  use_home: boolean;
  alternate_latitude: number | null;
  alternate_longitude: number | null;
};
type Assignment = {
  id: string;
  official_id: string;
  status: string;
  game_fee: number;
  mileage_miles: number;
  mileage_rate: number;
  payment_status: "unpaid" | "approved" | "paid" | "void";
  paid_at: string | null;
  officials: Official | null;
  sport_positions: { name: string } | null;
  games: {
    id: string;
    game_number: string | null;
    starts_at: string;
    status: string;
    home: { name: string } | null;
    away: { name: string } | null;
    location: {
      name: string;
      city: string | null;
      state: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    levels: { name: string } | null;
    leagues: { name: string; mileage_plan: MileagePlan } | null;
  } | null;
};
type Dimension = "team" | "location" | "level" | "position";
type Period = "all" | "season" | "30" | "year" | "custom";
type CountRow = [string, number];

const nameOf = (official: Official | null) =>
  official
    ? `${official.first_name} ${official.last_name}`.trim()
    : "Unknown official";
const milesBetween = (
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
) => {
  if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return null;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(Number(lat2) - Number(lat1)),
    dLon = radians(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(Number(lat1))) *
      Math.cos(radians(Number(lat2))) *
      Math.sin(dLon / 2) ** 2;
  return (
    Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) /
    10
  );
};

function BarChart({ title, rows }: { title: string; rows: CountRow[] }) {
  const shown = rows.slice(0, 8),
    max = Math.max(1, ...shown.map((row) => row[1]));
  return (
    <article className="reportChart">
      <h4>{title}</h4>
      <div className="reportBars">
        {shown.length ? (
          shown.map(([label, value]) => (
            <div className="reportBarRow" key={label}>
              <span title={label}>{label}</span>
              <i>
                <em style={{ width: `${(value / max) * 100}%` }} />
              </i>
              <b>{value}</b>
            </div>
          ))
        ) : (
          <p>No data for this period.</p>
        )}
      </div>
    </article>
  );
}

function PositionChart({ rows }: { rows: CountRow[] }) {
  const total = rows.reduce((sum, row) => sum + row[1], 0),
    colors = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444", "#0891b2"];
  let current = 0;
  const gradient = rows.length
    ? `conic-gradient(${rows
        .map((row, index) => {
          const start = current;
          current += (row[1] / total) * 100;
          return `${colors[index % colors.length]} ${start}% ${current}%`;
        })
        .join(",")})`
    : "#e2e8f0";
  return (
    <article className="reportChart">
      <h4>Assignments by position</h4>
      <div className="positionChart">
        <div className="positionDonut" style={{ background: gradient }}>
          <span>
            <b>{total}</b>games
          </span>
        </div>
        <div className="positionLegend">
          {rows.map(([label, value], index) => (
            <div key={label}>
              <i style={{ background: colors[index % colors.length] }} />
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function TrendChart({
  rows,
}: {
  rows: { label: string; games: number; miles: number }[];
}) {
  const maxGames = Math.max(1, ...rows.map((row) => row.games)),
    maxMiles = Math.max(1, ...rows.map((row) => row.miles));
  return (
    <article className="reportChart reportTrend">
      <div className="reportChartTitle">
        <h4>Monthly games and mileage</h4>
        <span>
          <i className="gamesKey" /> Games <i className="milesKey" /> Miles
        </span>
      </div>
      <div className="trendRows">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <div>
              <i
                className="gamesTrend"
                style={{ width: `${(row.games / maxGames) * 100}%` }}
              >
                <b>{row.games}</b>
              </i>
              <i
                className="milesTrend"
                style={{ width: `${(row.miles / maxMiles) * 100}%` }}
              >
                <b>{row.miles.toFixed(1)}</b>
              </i>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function OfficialReports({
  managerView = false,
  organizationId,
}: {
  managerView?: boolean;
  organizationId?: string;
}) {
  const [officials, setOfficials] = useState<Official[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [origins, setOrigins] = useState<Origin[]>([]);
  const [officialId, setOfficialId] = useState(""),
    [period, setPeriod] = useState<Period>("season"),
    [dimension, setDimension] = useState<Dimension>("team"),
    [payer, setPayer] = useState("all"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reportingAccess, setReportingAccess] = useState<"standard" | "premium">(
      "standard",
    );

  async function load(nextOfficialId = officialId) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (managerView) params.set("scope", "manager");
      if (organizationId) params.set("organizationId", organizationId);
      if (nextOfficialId) params.set("officialId", nextOfficialId);
      const query = params.size ? `?${params.toString()}` : "";
      const response = await fetch(`/api/reports/officials${query}`, {
          cache: "no-store",
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Official reporting could not be loaded.",
        );
      const loadedOfficials = (result.officials || []) as Official[],
        selectedId =
          result.selectedOfficialId ||
          nextOfficialId ||
          loadedOfficials[0]?.id ||
          "";
      setOfficials(loadedOfficials);
      setOfficialId(selectedId);
      setAssignments((result.assignments || []) as Assignment[]);
      setOrigins((result.weekdayOrigins || []) as Origin[]);
      setReportingAccess(
        result.reportingAccess === "premium" ? "premium" : "standard",
      );
      if (managerView && !nextOfficialId && selectedId) {
        const selectedResponse = await fetch(
            `/api/reports/officials?scope=manager&officialId=${encodeURIComponent(selectedId)}&organizationId=${encodeURIComponent(organizationId || "")}`,
            { cache: "no-store" },
          ),
          selectedResult = await selectedResponse.json();
        if (!selectedResponse.ok)
          throw new Error(
            selectedResult.error || "Official reporting could not be loaded.",
          );
        setAssignments((selectedResult.assignments || []) as Assignment[]);
        setOrigins((selectedResult.weekdayOrigins || []) as Origin[]);
        setReportingAccess(
          selectedResult.reportingAccess === "premium" ? "premium" : "standard",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Official reporting could not be loaded.",
      );
    }
    setLoading(false);
  }
  useEffect(() => {
    void load("");
  }, [organizationId]);

  const effectiveMiles = (assignment: Assignment) => {
    const saved = Number(assignment.mileage_miles || 0);
    if (saved > 0) return saved;
    const game = assignment.games,
      official = assignment.officials,
      plan = game?.leagues?.mileage_plan || "round_trip";
    if (plan === "none") return 0;
    if (plan === "actual" || !game || !official) return saved;
    const weekday = new Date(game.starts_at).getDay(),
      origin = origins.find(
        (item) =>
          item.official_id === assignment.official_id &&
          item.weekday === weekday,
      ),
      alternate = Boolean(origin && !origin.use_home);
    const oneWay = milesBetween(
      alternate ? origin!.alternate_latitude : official.home_latitude,
      alternate ? origin!.alternate_longitude : official.home_longitude,
      game.location?.latitude ?? null,
      game.location?.longitude ?? null,
    );
    if (oneWay == null) return saved;
    return plan === "round_trip" ? Math.round(oneWay * 2 * 10) / 10 : oneWay;
  };
  const visible = useMemo(() => {
    const now = new Date(),
      cutoff = new Date(now);
    if (period === "30") cutoff.setDate(now.getDate() - 30);
    if (period === "year") cutoff.setFullYear(now.getFullYear() - 1);
    if (period === "season") cutoff.setMonth(now.getMonth() - 6);
    return assignments
      .filter((assignment) => {
        const date = new Date(assignment.games?.starts_at || 0),
          payerMatches =
            payer === "all" || assignment.games?.leagues?.name === payer;
        if (!payerMatches) return false;
        if (period === "custom") {
          const afterStart =
              !startDate || date >= new Date(`${startDate}T00:00:00`),
            beforeEnd = !endDate || date <= new Date(`${endDate}T23:59:59`);
          return afterStart && beforeEnd;
        }
        return period === "all" || date >= cutoff;
      })
      .sort(
        (a, b) =>
          new Date(b.games?.starts_at || 0).getTime() -
          new Date(a.games?.starts_at || 0).getTime(),
      );
  }, [assignments, period, payer, startDate, endDate]);
  const payers = useMemo(
    () =>
      [
        ...new Set(
          assignments.map(
            (item) => item.games?.leagues?.name || "Not specified",
          ),
        ),
      ].sort(),
    [assignments],
  );
  const summary = useMemo(() => {
    const counts = new Map<string, number>(),
      add = (label: string | null | undefined) =>
        counts.set(
          label || "Not specified",
          (counts.get(label || "Not specified") || 0) + 1,
        );
    visible.forEach((assignment) => {
      const game = assignment.games;
      if (dimension === "team") {
        add(game?.home?.name);
        add(game?.away?.name);
      }
      if (dimension === "location") add(game?.location?.name);
      if (dimension === "level") add(game?.levels?.name);
      if (dimension === "position") add(assignment.sport_positions?.name);
    });
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [visible, dimension]);
  const breakdowns = useMemo(() => {
    const make = (kind: Dimension) => {
      const counts = new Map<string, number>(),
        add = (label?: string | null) =>
          counts.set(
            label || "Not specified",
            (counts.get(label || "Not specified") || 0) + 1,
          );
      visible.forEach((assignment) => {
        const game = assignment.games;
        if (kind === "team") {
          add(game?.home?.name);
          add(game?.away?.name);
        } else if (kind === "location") add(game?.location?.name);
        else if (kind === "level") add(game?.levels?.name);
        else add(assignment.sport_positions?.name);
      });
      return [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      ) as CountRow[];
    };
    return {
      team: make("team"),
      location: make("location"),
      level: make("level"),
      position: make("position"),
    };
  }, [visible]);
  const monthly = useMemo(() => {
    const months = new Map<
      string,
      { sort: string; label: string; games: number; miles: number }
    >();
    visible.forEach((assignment) => {
      const date = new Date(assignment.games?.starts_at || 0),
        sort = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const row = months.get(sort) || {
        sort,
        label: date.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        games: 0,
        miles: 0,
      };
      row.games += 1;
      row.miles += effectiveMiles(assignment);
      months.set(sort, row);
    });
    return [...months.values()]
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .slice(-12);
  }, [visible, origins]);
  const totalMiles = visible.reduce(
      (total, assignment) => total + effectiveMiles(assignment),
      0,
    ),
    gameFees = visible.reduce(
      (total, assignment) =>
        total +
        (assignment.payment_status === "void"
          ? 0
          : Number(assignment.game_fee || 0)),
      0,
    ),
    mileagePay = visible.reduce(
      (total, assignment) =>
        total +
        (assignment.payment_status === "void"
          ? 0
          : effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)),
      0,
    ),
    totalPay = gameFees + mileagePay,
    unpaidPay = visible.reduce(
      (total, assignment) =>
        total +
        (["unpaid", "approved"].includes(assignment.payment_status)
          ? Number(assignment.game_fee || 0) +
            effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)
          : 0),
      0,
    ),
    selectedOfficial =
      officials.find((official) => official.id === officialId) || null;
  const payerSummary = useMemo(() => {
    const rows = new Map<
      string,
      {
        games: number;
        fees: number;
        miles: number;
        mileagePay: number;
        total: number;
        unpaid: number;
      }
    >();
    visible.forEach((assignment) => {
      const label = assignment.games?.leagues?.name || "Not specified",
        row = rows.get(label) || {
          games: 0,
          fees: 0,
          miles: 0,
          mileagePay: 0,
          total: 0,
          unpaid: 0,
        },
        miles = effectiveMiles(assignment),
        active = assignment.payment_status !== "void",
        fee = active ? Number(assignment.game_fee || 0) : 0,
        travel = active ? miles * Number(assignment.mileage_rate || 0) : 0;
      row.games += 1;
      row.fees += fee;
      row.miles += miles;
      row.mileagePay += travel;
      row.total += fee + travel;
      if (["unpaid", "approved"].includes(assignment.payment_status))
        row.unpaid += fee + travel;
      rows.set(label, row);
    });
    return [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, origins]);
  const csv = () => {
    const cells = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = visible.map((assignment) => {
      const game = assignment.games;
      const standard = [
        game?.starts_at ? new Date(game.starts_at).toLocaleDateString() : "",
        game?.game_number || "",
        game?.home?.name || "TBD",
        game?.away?.name || "TBD",
        game?.location?.name || "",
        game?.levels?.name || "",
        assignment.sport_positions?.name || "",
        game?.leagues?.name || "Not specified",
        effectiveMiles(assignment).toFixed(1),
      ];
      const premium = [
        Number(assignment.game_fee || 0).toFixed(2),
        Number(assignment.mileage_rate || 0).toFixed(3),
        (
          effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)
        ).toFixed(2),
        (
          Number(assignment.game_fee || 0) +
          effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)
        ).toFixed(2),
        assignment.payment_status,
      ];
      return [...standard, ...(reportingAccess === "premium" ? premium : [])]
        .map(cells)
        .join(",");
    });
    const blob = new Blob(
        [
          [
            reportingAccess === "premium"
              ? "Date,Game Number,Home Team,Away Team,Location,Level,Position,Paying Organization,Miles,Game Fee,Mileage Rate,Mileage Reimbursement,Total Compensation,Payment Status"
              : "Date,Game Number,Home Team,Away Team,Location,Level,Position,Paying Organization,Miles",
            ...rows,
          ].join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `refassign-${nameOf(selectedOfficial)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-assignments.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const pdf = async () => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const document = new jsPDF({ unit: "pt", format: "letter" });
    const navy: [number, number, number] = [12, 30, 55];
    const blue: [number, number, number] = [37, 99, 235];
    const green: [number, number, number] = [97, 212, 48];
    const periodLabel =
      period === "30"
        ? "Last 30 days"
        : period === "season"
          ? "Last 6 months"
          : period === "year"
            ? "Last 12 months"
            : period === "custom"
              ? `${startDate || "Beginning"} through ${endDate || "Today"}`
              : "All assignments";
    const header = () => {
      document.setFillColor(...navy);
      document.rect(0, 0, 612, 74, "F");
      document.setTextColor(255, 255, 255);
      document.setFont("helvetica", "bold");
      document.setFontSize(20);
      document.text("REF", 38, 34);
      document.setTextColor(...green);
      document.text("ASSIGN", 77, 34);
      document.setTextColor(220, 231, 243);
      document.setFontSize(9);
      document.text("OFFICIAL ACTIVITY REPORT", 38, 52);
    };
    const footer = () => {
      const pages = document.getNumberOfPages();
      for (let page = 1; page <= pages; page++) {
        document.setPage(page);
        document.setDrawColor(220, 228, 238);
        document.line(36, 756, 576, 756);
        document.setFontSize(8);
        document.setTextColor(100, 116, 139);
        document.text(
          `Generated ${new Date().toLocaleDateString()}  |  RefAssign`,
          36,
          772,
        );
        document.text(`Page ${page} of ${pages}`, 576, 772, { align: "right" });
      }
    };
    const section = (title: string, y: number) => {
      document.setTextColor(...navy);
      document.setFont("helvetica", "bold");
      document.setFontSize(12);
      document.text(title, 38, y);
    };
    const drawBars = (
      title: string,
      rows: CountRow[],
      x: number,
      y: number,
      width: number,
    ) => {
      section(title, y);
      const shown = rows.slice(0, 6),
        max = Math.max(1, ...shown.map((row) => row[1]));
      shown.forEach(([label, value], index) => {
        const rowY = y + 17 + index * 18;
        document.setFont("helvetica", "normal");
        document.setFontSize(7.5);
        document.setTextColor(51, 65, 85);
        document.text(label.slice(0, 24), x, rowY);
        document.setFillColor(226, 232, 240);
        document.roundedRect(x + 90, rowY - 7, width - 112, 7, 2, 2, "F");
        document.setFillColor(...blue);
        document.roundedRect(
          x + 90,
          rowY - 7,
          Math.max(2, ((width - 112) * value) / max),
          7,
          2,
          2,
          "F",
        );
        document.setFont("helvetica", "bold");
        document.text(String(value), x + width, rowY, { align: "right" });
      });
    };
    header();
    document.setTextColor(...navy);
    document.setFontSize(18);
    document.setFont("helvetica", "bold");
    document.text(nameOf(selectedOfficial), 38, 108);
    document.setFontSize(10);
    document.setFont("helvetica", "normal");
    document.setTextColor(100, 116, 139);
    document.text(periodLabel, 38, 125);
    [
      ["GAME ASSIGNMENTS", String(visible.length)],
      ["TOTAL MILES", totalMiles.toFixed(1)],
      [
        "AVERAGE MILES / GAME",
        visible.length ? (totalMiles / visible.length).toFixed(1) : "0.0",
      ],
    ].forEach(([label, value], index) => {
      const x = 38 + index * 180;
      document.setFillColor(248, 250, 252);
      document.setDrawColor(219, 228, 238);
      document.roundedRect(x, 144, 165, 56, 6, 6, "FD");
      document.setFontSize(7);
      document.setFont("helvetica", "bold");
      document.setTextColor(100, 116, 139);
      document.text(label, x + 12, 162);
      document.setFontSize(18);
      document.setTextColor(...navy);
      document.text(value, x + 12, 187);
    });
    drawBars("Games by team", breakdowns.team, 38, 230, 250);
    drawBars("Games by location", breakdowns.location, 324, 230, 250);
    drawBars("Games by level", breakdowns.level, 38, 370, 250);
    drawBars("Games by position", breakdowns.position, 324, 370, 250);
    section("Monthly games and mileage", 520);
    const maxGames = Math.max(1, ...monthly.map((row) => row.games)),
      maxMiles = Math.max(1, ...monthly.map((row) => row.miles));
    monthly.slice(-6).forEach((row, index) => {
      const y = 541 + index * 25;
      document.setFontSize(7);
      document.setTextColor(51, 65, 85);
      document.text(row.label, 38, y);
      document.setFillColor(...blue);
      document.rect(92, y - 8, (170 * row.games) / maxGames, 6, "F");
      document.setFillColor(...green);
      document.rect(92, y + 1, (170 * row.miles) / maxMiles, 6, "F");
      document.setFont("helvetica", "bold");
      document.text(`${row.games} games`, 270, y - 2, { align: "right" });
      document.text(`${row.miles.toFixed(1)} mi`, 270, y + 7, {
        align: "right",
      });
    });
    if (reportingAccess === "premium") {
      document.addPage();
      header();
      section("Compensation by paying organization", 106);
      autoTable(document, {
        startY: 118,
        head: [
          [
            "Organization",
            "Games",
            "Game fees",
            "Miles",
            "Mileage pay",
            "Total",
            "Unpaid",
          ],
        ],
        body: payerSummary.map(([label, row]) => [
          label,
          row.games,
          `$${row.fees.toFixed(2)}`,
          row.miles.toFixed(1),
          `$${row.mileagePay.toFixed(2)}`,
          `$${row.total.toFixed(2)}`,
          `$${row.unpaid.toFixed(2)}`,
        ]),
        margin: { top: 90, right: 36, left: 36 },
        styles: { fontSize: 8, cellPadding: 5, textColor: navy },
        headStyles: { fillColor: navy, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }
    document.addPage();
    header();
    section("Assignment and tax mileage detail", 106);
    autoTable(document, {
      startY: 118,
      head: [
        [
          "Date",
          "Game",
          "Organization",
          "Position",
          ...(reportingAccess === "premium" ? ["Fee"] : []),
          "Miles",
          ...(reportingAccess === "premium"
            ? ["Mileage pay", "Total", "Status"]
            : []),
        ],
      ],
      body: visible.map((assignment) => {
        const game = assignment.games;
        return [
          game?.starts_at ? new Date(game.starts_at).toLocaleDateString() : "-",
          game?.game_number || "-",
          game?.leagues?.name || "Not specified",
          assignment.sport_positions?.name || "-",
          ...(reportingAccess === "premium"
            ? [`$${Number(assignment.game_fee || 0).toFixed(2)}`]
            : []),
          effectiveMiles(assignment).toFixed(1),
          ...(reportingAccess === "premium"
            ? [
                `$${(effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)).toFixed(2)}`,
                `$${(Number(assignment.game_fee || 0) + effectiveMiles(assignment) * Number(assignment.mileage_rate || 0)).toFixed(2)}`,
                assignment.payment_status,
              ]
            : []),
        ];
      }),
      margin: { top: 90, right: 36, bottom: 42, left: 36 },
      styles: { fontSize: 7, cellPadding: 4, textColor: navy },
      headStyles: { fillColor: navy, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        2: { cellWidth: 90 },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
      },
      didDrawPage: () => {
        if (document.getCurrentPageInfo().pageNumber > 2) header();
      },
    });
    footer();
    document.save(
      `refassign-${nameOf(selectedOfficial)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-report.pdf`,
    );
  };

  return (
    <section className="card officialReports">
      <div className="cardHead">
        <div>
          <h2>
            {managerView ? "Official Activity Report" : "My Officiating Report"}
          </h2>
          <p>
            Game counts by team, location, level and position, with mileage for
            every assignment.
          </p>
          <span className="badge">
            {reportingAccess === "premium"
              ? "Premium reporting"
              : "Standard reporting"}
          </span>
        </div>
        <div className="headerActions">
          <button
            className="secondary"
            disabled={!visible.length}
            onClick={csv}
          >
            Export CSV
          </button>
          <button
            className="primary"
            disabled={!visible.length}
            onClick={() => void pdf()}
          >
            Export PDF
          </button>
        </div>
      </div>
      <div className="reportFilters">
        {managerView && (
          <label>
            Official
            <select
              value={officialId}
              onChange={(event) => {
                setOfficialId(event.target.value);
                void load(event.target.value);
              }}
            >
              {officials.map((official) => (
                <option key={official.id} value={official.id}>
                  {nameOf(official)}
                  {official.active ? "" : " (Inactive)"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Reporting period
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
          >
            <option value="season">Last 6 months</option>
            <option value="30">Last 30 days</option>
            <option value="year">Last 12 months</option>
            <option value="custom">Custom dates</option>
            <option value="all">All assignments</option>
          </select>
        </label>
        {period === "custom" && (
          <>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </>
        )}
        <label>
          Paying organization
          <select
            value={payer}
            onChange={(event) => setPayer(event.target.value)}
          >
            <option value="all">All organizations</option>
            {payers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {loading ? (
        <p>Loading official report…</p>
      ) : (
        <>
          <div className="reportMetrics">
            <div>
              <span>Official</span>
              <b>{nameOf(selectedOfficial)}</b>
            </div>
            <div>
              <span>Game assignments</span>
              <b>{visible.length}</b>
            </div>
            <div>
              <span>Total miles</span>
              <b>{totalMiles.toFixed(1)}</b>
            </div>
            <div>
              <span>Average miles / game</span>
              <b>
                {visible.length
                  ? (totalMiles / visible.length).toFixed(1)
                  : "0.0"}
              </b>
            </div>
            {reportingAccess === "premium" && (
              <>
                <div>
                  <span>Game fees</span>
                  <b>${gameFees.toFixed(2)}</b>
                </div>
                <div>
                  <span>Mileage reimbursement</span>
                  <b>${mileagePay.toFixed(2)}</b>
                </div>
                <div>
                  <span>Total compensation</span>
                  <b>${totalPay.toFixed(2)}</b>
                </div>
                <div>
                  <span>Unpaid / awaiting payment</span>
                  <b>${unpaidPay.toFixed(2)}</b>
                </div>
              </>
            )}
          </div>
          {reportingAccess === "premium" && (
            <>
              <h3>Compensation by paying organization</h3>
              <div className="tableWrap">
                <table className="officialReportTable">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>Games</th>
                      <th>Game fees</th>
                      <th>Miles</th>
                      <th>Mileage pay</th>
                      <th>Total</th>
                      <th>Unpaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payerSummary.length ? (
                      payerSummary.map(([label, row]) => (
                        <tr key={label}>
                          <td>
                            <b>{label}</b>
                          </td>
                          <td>{row.games}</td>
                          <td>${row.fees.toFixed(2)}</td>
                          <td>{row.miles.toFixed(1)}</td>
                          <td>${row.mileagePay.toFixed(2)}</td>
                          <td>
                            <b>${row.total.toFixed(2)}</b>
                          </td>
                          <td>${row.unpaid.toFixed(2)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7}>
                          No compensation in this reporting period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="reportCharts">
            <BarChart title="Games by team" rows={breakdowns.team} />
            <BarChart title="Games by location" rows={breakdowns.location} />
            <PositionChart rows={breakdowns.position} />
            <BarChart title="Games by level" rows={breakdowns.level} />
            <TrendChart rows={monthly} />
          </div>
          <div className="reportDimensionTabs">
            {(["team", "location", "level", "position"] as Dimension[]).map(
              (item) => (
                <button
                  key={item}
                  className={dimension === item ? "active" : ""}
                  onClick={() => setDimension(item)}
                >
                  By {item[0].toUpperCase() + item.slice(1)}
                </button>
              ),
            )}
          </div>
          <div className="reportCountGrid">
            {summary.length ? (
              summary.map(([label, count]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b>
                    {count} {count === 1 ? "game" : "games"}
                  </b>
                </div>
              ))
            ) : (
              <p>No assignments in this reporting period.</p>
            )}
          </div>
          <h3>Assignment detail</h3>
          <div className="tableWrap">
            <table className="officialReportTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Teams</th>
                  <th>Location</th>
                  <th>Level</th>
                  <th>Position</th>
                  <th>Paying organization</th>
                  <th>Miles</th>
                  {reportingAccess === "premium" && (
                    <>
                      <th>Game fee</th>
                      <th>Mileage pay</th>
                      <th>Total</th>
                      <th>Payment</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((assignment) => {
                    const game = assignment.games;
                    return (
                      <tr key={assignment.id}>
                        <td>
                          {game?.starts_at
                            ? new Date(game.starts_at).toLocaleDateString()
                            : "—"}
                          <small>
                            {game?.starts_at
                              ? new Date(game.starts_at).toLocaleTimeString(
                                  [],
                                  { hour: "numeric", minute: "2-digit" },
                                )
                              : ""}
                          </small>
                        </td>
                        <td>
                          <b>{game?.game_number || "—"}</b>
                        </td>
                        <td>
                          {game?.home?.name || "TBD"}
                          <small>vs {game?.away?.name || "TBD"}</small>
                        </td>
                        <td>
                          {game?.location?.name || "—"}
                          <small>
                            {[game?.location?.city, game?.location?.state]
                              .filter(Boolean)
                              .join(", ")}
                          </small>
                        </td>
                        <td>{game?.levels?.name || "—"}</td>
                        <td>{assignment.sport_positions?.name || "—"}</td>
                        <td>{game?.leagues?.name || "Not specified"}</td>
                        <td>
                          <b>{effectiveMiles(assignment).toFixed(1)}</b>
                        </td>
                        {reportingAccess === "premium" && (
                          <>
                            <td>
                              ${Number(assignment.game_fee || 0).toFixed(2)}
                            </td>
                            <td>
                              $
                              {(
                                effectiveMiles(assignment) *
                                Number(assignment.mileage_rate || 0)
                              ).toFixed(2)}
                            </td>
                            <td>
                              <b>
                                $
                                {(
                                  Number(assignment.game_fee || 0) +
                                  effectiveMiles(assignment) *
                                    Number(assignment.mileage_rate || 0)
                                ).toFixed(2)}
                              </b>
                            </td>
                            <td>{assignment.payment_status}</td>
                          </>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={reportingAccess === "premium" ? 12 : 8}>
                      No assignments in this reporting period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
