"use client";

import { useState } from "react";
import AssignmentCoverageReport from "./AssignmentCoverageReport";
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
import StaffingForecastReport from "./StaffingForecastReport";
import TrainingDevelopmentReport from "./TrainingDevelopmentReport";

type ReportKey =
  | "executive"
  | "operations"
  | "benchmarks"
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

const standardReports: Array<{ key: ReportKey; label: string }> = [
  { key: "operations", label: "Organization Operations" },
  { key: "coverage", label: "Assignment Coverage" },
  { key: "declines", label: "Declines & Replacements" },
  { key: "compliance", label: "Compliance & Eligibility" },
  { key: "development", label: "Training & Development" },
  { key: "communications", label: "Communication Effectiveness" },
  { key: "utilization", label: "Official Utilization" },
  { key: "officials", label: "Official Activity" },
  { key: "payroll", label: "Payroll & Payments" },
];

const premiumReports: Array<{ key: ReportKey; label: string }> = [
  { key: "executive", label: "Executive Dashboard" },
  { key: "forecast", label: "Staffing Forecast" },
  { key: "financial", label: "Financial Forecast" },
  { key: "benchmarks", label: "Organization Benchmarks" },
  { key: "custom", label: "Custom Builder" },
];

const premiumKeys = new Set<ReportKey>(premiumReports.map((item) => item.key));

export default function ManagerReports({ organizationId }: { organizationId?: string }) {
  const [group, setGroup] = useState<ReportGroup>("standard");
  const [report, setReport] = useState<ReportKey>("operations");
  const visibleReports = group === "standard" ? standardReports : premiumReports;

  const chooseGroup = (nextGroup: ReportGroup) => {
    setGroup(nextGroup);
    setReport(nextGroup === "standard" ? standardReports[0].key : premiumReports[0].key);
  };

  const openReport = (nextReport: ReportKey) => {
    setGroup(premiumKeys.has(nextReport) ? "premium" : "standard");
    setReport(nextReport);
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
            <button
              type="button"
              key={item.key}
              className={report === item.key ? "active" : ""}
              onClick={() => openReport(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>
      {report === "executive" ? (
        <ExecutiveReportingDashboard onOpenReport={openReport} />
      ) : report === "operations" ? (
        <OrganizationOperationsReport />
      ) : report === "benchmarks" ? (
        <OrganizationBenchmarkDashboard />
      ) : report === "coverage" ? (
        <AssignmentCoverageReport />
      ) : report === "declines" ? (
        <DeclineReplacementReport />
      ) : report === "compliance" ? (
        <ComplianceEligibilityReport />
      ) : report === "development" ? (
        <TrainingDevelopmentReport />
      ) : report === "communications" ? (
        <CommunicationEffectivenessReport />
      ) : report === "forecast" ? (
        <StaffingForecastReport />
      ) : report === "financial" ? (
        <FinancialForecastReport />
      ) : report === "utilization" ? (
        <OfficialUtilizationReport />
      ) : report === "payroll" ? (
        <PayrollPaymentReport />
      ) : report === "custom" ? (
        <CustomReportBuilder />
      ) : (
        <OfficialReports managerView organizationId={organizationId} />
      )}
    </>
  );
}
