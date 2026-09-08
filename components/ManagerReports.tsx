"use client";

import { useState } from "react";
import AssignmentCoverageReport from "./AssignmentCoverageReport";
import ComplianceEligibilityReport from "./ComplianceEligibilityReport";
import CommunicationEffectivenessReport from "./CommunicationEffectivenessReport";
import DeclineReplacementReport from "./DeclineReplacementReport";
import ExecutiveReportingDashboard from "./ExecutiveReportingDashboard";
import FinancialForecastReport from "./FinancialForecastReport";
import OrganizationOperationsReport from "./OrganizationOperationsReport";
import OrganizationBenchmarkDashboard from "./OrganizationBenchmarkDashboard";
import OfficialReports from "./OfficialReports";
import OfficialUtilizationReport from "./OfficialUtilizationReport";
import PayrollPaymentReport from "./PayrollPaymentReport";
import StaffingForecastReport from "./StaffingForecastReport";
import TrainingDevelopmentReport from "./TrainingDevelopmentReport";
import CustomReportBuilder from "./CustomReportBuilder";

export default function ManagerReports() {
  const [report, setReport] = useState<
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
    | "custom"
  >("executive");
  return (
    <>
      <section className="card">
        <div className="reportDimensionTabs">
          <button
            className={report === "executive" ? "active" : ""}
            onClick={() => setReport("executive")}
          >
            Executive Dashboard
          </button>
          <button
            className={report === "operations" ? "active" : ""}
            onClick={() => setReport("operations")}
          >
            Organization Operations
          </button>
          <button
            className={report === "benchmarks" ? "active" : ""}
            onClick={() => setReport("benchmarks")}
          >
            Organization Benchmarks <span className="premiumTabMark">◆</span>
          </button>
          <button
            className={report === "coverage" ? "active" : ""}
            onClick={() => setReport("coverage")}
          >
            Assignment Coverage
          </button>
          <button
            className={report === "declines" ? "active" : ""}
            onClick={() => setReport("declines")}
          >
            Declines &amp; Replacements
          </button>
          <button
            className={report === "compliance" ? "active" : ""}
            onClick={() => setReport("compliance")}
          >
            Compliance &amp; Eligibility
          </button>
          <button
            className={report === "development" ? "active" : ""}
            onClick={() => setReport("development")}
          >
            Training &amp; Development
          </button>
          <button
            className={report === "communications" ? "active" : ""}
            onClick={() => setReport("communications")}
          >
            Communication Effectiveness
          </button>
          <button
            className={report === "forecast" ? "active" : ""}
            onClick={() => setReport("forecast")}
          >
            Staffing Forecast
          </button>
          <button
            className={report === "financial" ? "active" : ""}
            onClick={() => setReport("financial")}
          >
            Financial Forecast
          </button>
          <button
            className={report === "utilization" ? "active" : ""}
            onClick={() => setReport("utilization")}
          >
            Official Utilization
          </button>
          <button
            className={report === "officials" ? "active" : ""}
            onClick={() => setReport("officials")}
          >
            Official Activity
          </button>
          <button
            className={report === "custom" ? "active" : ""}
            onClick={() => setReport("custom")}
          >
            Custom Builder <span className="premiumTabMark">◆</span>
          </button>
          <button
            className={report === "payroll" ? "active" : ""}
            onClick={() => setReport("payroll")}
          >
            Payroll & Payments
          </button>
        </div>
      </section>
      {report === "executive" ? (
        <ExecutiveReportingDashboard onOpenReport={setReport} />
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
        <OfficialReports managerView />
      )}
    </>
  );
}
