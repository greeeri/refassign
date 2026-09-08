"use client";

import { useState } from "react";
import AssignmentCoverageReport from "./AssignmentCoverageReport";
import OrganizationOperationsReport from "./OrganizationOperationsReport";
import OfficialReports from "./OfficialReports";
import OfficialUtilizationReport from "./OfficialUtilizationReport";
import PayrollPaymentReport from "./PayrollPaymentReport";
import StaffingForecastReport from "./StaffingForecastReport";

export default function ManagerReports() {
  const [report, setReport] = useState<
    | "operations"
    | "coverage"
    | "forecast"
    | "utilization"
    | "officials"
    | "payroll"
  >("operations");
  return (
    <>
      <section className="card">
        <div className="reportDimensionTabs">
          <button
            className={report === "operations" ? "active" : ""}
            onClick={() => setReport("operations")}
          >
            Organization Operations
          </button>
          <button
            className={report === "coverage" ? "active" : ""}
            onClick={() => setReport("coverage")}
          >
            Assignment Coverage
          </button>
          <button
            className={report === "forecast" ? "active" : ""}
            onClick={() => setReport("forecast")}
          >
            Staffing Forecast
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
            className={report === "payroll" ? "active" : ""}
            onClick={() => setReport("payroll")}
          >
            Payroll & Payments
          </button>
        </div>
      </section>
      {report === "operations" ? (
        <OrganizationOperationsReport />
      ) : report === "coverage" ? (
        <AssignmentCoverageReport />
      ) : report === "forecast" ? (
        <StaffingForecastReport />
      ) : report === "utilization" ? (
        <OfficialUtilizationReport />
      ) : report === "payroll" ? (
        <PayrollPaymentReport />
      ) : (
        <OfficialReports managerView />
      )}
    </>
  );
}
