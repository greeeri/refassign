"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AssignmentCoverageReport from "./AssignmentCoverageReport";
import AuditHistoryManager from "./AuditHistoryManager";
import ComplianceEligibilityReport from "./ComplianceEligibilityReport";
import CommunicationEffectivenessReport from "./CommunicationEffectivenessReport";
import CustomReportBuilder from "./CustomReportBuilder";
import DeclineReplacementReport from "./DeclineReplacementReport";
import ExecutiveReportingDashboard from "./ExecutiveReportingDashboard";
import FinancialForecastReport from "./FinancialForecastReport";
import OrganizationBenchmarkDashboard from "./OrganizationBenchmarkDashboard";
import OrganizationOperationsReport from "./OrganizationOperationsReport";
import OfficialReports from "./OfficialReports";
import OfficialUtilizationReport from "./OfficialUtilizationReport";
import PayrollPaymentReport from "./PayrollPaymentReport";
import ReportingOverview from "./ReportingOverview";
import StaffingForecastReport from "./StaffingForecastReport";
import TrainingDevelopmentReport from "./TrainingDevelopmentReport";

type ReportKey =
  | "overview"
  | "executive"
  | "operations"
  | "benchmarks"
  | "audit"
  | "coverage"
  | "compliance"
  | "communications"
  | "declines"
  | "financial"
  | "forecast"
  | "utilization"
  | "development"
  | "officials"
  | "payroll"
  | "custom";
type ReportGroup = "standard" | "premium";

type ReportOption = { key: ReportKey; label: string; description: string };

const standardReports: ReportOption[] = [
  { key: "overview", label: "Overview", description: "See operational health, data-quality checks, and the reports that need attention." },
  { key: "operations", label: "Organization Operations", description: "Review games, staffing, assignment responses, and operating activity." },
  { key: "audit", label: "Change & Audit", description: "Track who changed games and assignments, when they changed, and what was affected." },
  { key: "coverage", label: "Assignment Coverage", description: "Find open positions and measure coverage by league, level, location, and date." },
  { key: "declines", label: "Declines & Replacements", description: "Understand decline patterns and how quickly open positions are refilled." },
  { key: "compliance", label: "Compliance & Eligibility", description: "Identify certification, registration, payment, and eligibility gaps." },
  { key: "development", label: "Training & Development", description: "Monitor learning progress, quiz results, mentoring, and advancement readiness." },
  { key: "communications", label: "Communication Effectiveness", description: "Review delivery, responses, reminders, and missing contact information." },
  { key: "utilization", label: "Official Utilization", description: "See assignment volume, workload distribution, response rates, and inactivity." },
  { key: "officials", label: "Official Activity", description: "Open a detailed assignment history for each official." },
  { key: "payroll", label: "Payroll & Payments", description: "Review recorded fees, mileage, payment status, and payroll completeness." },
];

const premiumReports: ReportOption[] = [
  { key: "executive", label: "Executive Dashboard", description: "Combine operational, financial, compliance, and communication performance." },
  { key: "forecast", label: "Staffing Forecast", description: "Predict shortages and prioritize games using configurable coverage-risk alerts." },
  { key: "financial", label: "Financial Forecast", description: "Project officiating costs and compare future spending scenarios." },
  { key: "benchmarks", label: "Organization Benchmarks", description: "Compare coverage, workload, declines, travel, and costs across organizations." },
  { key: "custom", label: "Custom Builder", description: "Build, save, schedule, and export reports using your own dimensions and metrics." },
];

const premiumKeys = new Set<ReportKey>(premiumReports.map((item) => item.key));

export default function ManagerReports({ organizationId }: { organizationId?: string }) {
  const [group, setGroup] = useState<ReportGroup>("standard");
  const [report, setReport] = useState<ReportKey>("overview");
  const [reportingAccess, setReportingAccess] = useState<"standard" | "premium">("standard");
  const [accessKnown, setAccessKnown] = useState(false);
  const [favorites, setFavorites] = useState<ReportKey[]>([]);
  const visibleReports = group === "standard" ? standardReports : premiumReports;
  const selected = useMemo(() => [...standardReports, ...premiumReports].find((item) => item.key === report), [report]);
  const storageKey = `refassign-reporting-v1-${organizationId || "default"}`;
  const accessLoaded = useCallback((access: "standard" | "premium") => {
    setReportingAccess(access);
    setAccessKnown(true);
  }, []);

  useEffect(() => {
    const requestedReport = new URLSearchParams(window.location.search).get("report") as ReportKey | null;
    if (requestedReport && [...standardReports, ...premiumReports].some((item) => item.key === requestedReport)) {
      setReport(requestedReport);
      setGroup(premiumKeys.has(requestedReport) ? "premium" : "standard");
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored && [...standardReports, ...premiumReports].some((item) => item.key === stored)) {
      setReport(stored as ReportKey);
      setGroup(premiumKeys.has(stored as ReportKey) ? "premium" : "standard");
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${storageKey}-favorites`) || "[]") as ReportKey[];
      setFavorites(saved.filter((key) => premiumKeys.has(key)));
    } catch {
      setFavorites([]);
    }
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/reports/operations?organizationId=${encodeURIComponent(organizationId || "")}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Reporting access could not be loaded.");
        if (active) accessLoaded(result.reportingAccess === "premium" ? "premium" : "standard");
      } catch {
        if (active) {
          setReportingAccess("standard");
          setAccessKnown(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [accessLoaded, organizationId]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, report);
  }, [report, storageKey]);

  useEffect(() => {
    if (!accessKnown) return;
    setGroup(premiumKeys.has(report) ? "premium" : "standard");
  }, [accessKnown, report]);

  const chooseGroup = (nextGroup: ReportGroup) => {
    setGroup(nextGroup);
    setReport(nextGroup === "standard" ? standardReports[0].key : premiumReports[0].key);
  };

  const openReport = (nextReport: ReportKey) => {
    setGroup(premiumKeys.has(nextReport) ? "premium" : "standard");
    setReport(nextReport);
  };
  const toggleFavorite = (key: ReportKey) => {
    if (reportingAccess !== "premium") return;
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    setFavorites(next);
    window.localStorage.setItem(`${storageKey}-favorites`, JSON.stringify(next));
  };
  return (
    <>
      <section className="card reportNavigationCard">
        <div className="reportGroupTabs" role="tablist" aria-label="Reporting level">
          <button
            type="button"
            role="tab"
            aria-selected={group === "standard"}
            className={group === "standard" ? "active" : ""}
            onClick={() => chooseGroup("standard")}
          >
            Standard Reports
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={group === "premium"}
            className={group === "premium" ? "active premium" : "premium"}
            onClick={() => chooseGroup("premium")}
          >
            <span aria-hidden="true">◆</span> Premium Reports
          </button>
        </div>
        <div className="reportDimensionTabs">
          {visibleReports.map((item) => (
            <span className="reportNavChoice" key={item.key}>
              <button type="button" className={report === item.key ? "active" : ""} onClick={() => openReport(item.key)}>{item.label}</button>
              {group === "premium" && reportingAccess === "premium" ? <button type="button" className="reportFavorite" aria-label={`${favorites.includes(item.key) ? "Remove" : "Add"} ${item.label} ${favorites.includes(item.key) ? "from" : "to"} favorites`} onClick={() => toggleFavorite(item.key)}>{favorites.includes(item.key) ? "★" : "☆"}</button> : null}
            </span>
          ))}
        </div>
        <label className="reportMobileChooser">Choose report<select value={report} onChange={(event) => openReport(event.target.value as ReportKey)}>{visibleReports.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
        {selected ? <p className="reportDescription"><b>What this report tells you:</b> {selected.description}</p> : null}
        {reportingAccess === "premium" && favorites.length ? <div className="reportFavoriteLinks"><b>Favorites</b>{favorites.map((key) => { const item = premiumReports.find((option) => option.key === key); return item ? <button key={key} onClick={() => openReport(key)}>★ {item.label}</button> : null; })}</div> : null}
      </section>
      {group === "premium" && accessKnown && reportingAccess !== "premium" ? (
        <section className="card premiumReportGate"><span>◆</span><div><h2>Premium Reporting</h2><p>Scheduled delivery, configurable alerts, forecasting, organization comparisons, favorites, drill-down analysis, and branded PDF packages are available with Premium Reporting.</p></div></section>
      ) : report === "overview" ? (
        <ReportingOverview key={organizationId} organizationId={organizationId} onOpenReport={openReport} onAccessLoaded={accessLoaded} />
      ) : report === "executive" ? (
        <ExecutiveReportingDashboard key={organizationId} onOpenReport={openReport} organizationId={organizationId} />
      ) : report === "operations" ? (
        <OrganizationOperationsReport key={organizationId} organizationId={organizationId} />
      ) : report === "audit" ? (
        <AuditHistoryManager key={organizationId} organizationId={organizationId} />
      ) : report === "benchmarks" ? (
        <OrganizationBenchmarkDashboard key={organizationId} organizationId={organizationId} />
      ) : report === "coverage" ? (
        <AssignmentCoverageReport key={organizationId} organizationId={organizationId} />
      ) : report === "declines" ? (
        <DeclineReplacementReport key={organizationId} organizationId={organizationId} />
      ) : report === "compliance" ? (
        <ComplianceEligibilityReport key={organizationId} organizationId={organizationId} />
      ) : report === "development" ? (
        <TrainingDevelopmentReport key={organizationId} organizationId={organizationId} />
      ) : report === "communications" ? (
        <CommunicationEffectivenessReport key={organizationId} organizationId={organizationId} />
      ) : report === "forecast" ? (
        <StaffingForecastReport key={organizationId} organizationId={organizationId} />
      ) : report === "financial" ? (
        <FinancialForecastReport key={organizationId} organizationId={organizationId} />
      ) : report === "utilization" ? (
        <OfficialUtilizationReport key={organizationId} organizationId={organizationId} />
      ) : report === "payroll" ? (
        <PayrollPaymentReport key={organizationId} organizationId={organizationId} />
      ) : report === "custom" ? (
        <CustomReportBuilder key={organizationId} organizationId={organizationId} />
      ) : (
        <OfficialReports managerView organizationId={organizationId} />
      )}
    </>
  );
}
