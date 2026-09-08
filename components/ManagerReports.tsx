"use client";

import { useState } from "react";
import AssignmentCoverageReport from "./AssignmentCoverageReport";
import OfficialReports from "./OfficialReports";
import PayrollPaymentReport from "./PayrollPaymentReport";

export default function ManagerReports() {
  const [report, setReport] = useState<"coverage" | "officials" | "payroll">(
    "coverage",
  );
  return (
    <>
      <section className="card">
        <div className="reportDimensionTabs">
          <button
            className={report === "coverage" ? "active" : ""}
            onClick={() => setReport("coverage")}
          >
            Assignment Coverage
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
      {report === "coverage" ? (
        <AssignmentCoverageReport />
      ) : report === "payroll" ? (
        <PayrollPaymentReport />
      ) : (
        <OfficialReports managerView />
      )}
    </>
  );
}
