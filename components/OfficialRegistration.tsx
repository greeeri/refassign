"use client";

type Props = {
  onBack: () => void;
};

export default function OfficialRegistration({ onBack }: Props) {
  return (
    <div className="iowaTrainingPage">
      <section className="card">
        <button className="secondary" onClick={onBack}>
          ← Back to Official Dashboard
        </button>
        <div className="cardHead" style={{ marginTop: 16 }}>
          <div>
            <h2>Iowa Soccer Official Registration</h2>
            <p>
              Register as an Iowa Soccer official, complete the applicable
              registration payment, and follow your approval status.
            </p>
          </div>
        </div>
        <div className="registrarMetrics">
          <div>
            <strong>1</strong>
            <span>Complete registration</span>
          </div>
          <div>
            <strong>2</strong>
            <span>Pay registration fee</span>
          </div>
          <div>
            <strong>3</strong>
            <span>Registrar approval</span>
          </div>
        </div>
        <div className="buttonRow">
          <button
            className="primary"
            onClick={() => window.location.assign("/register")}
          >
            Start Official Registration
          </button>
          <button
            className="secondary"
            onClick={() => window.location.assign("/kit-request")}
          >
            Request Referee Kit
          </button>
        </div>
      </section>
      <section className="card">
        <h3>For officials</h3>
        <p>
          This page contains only your registration actions. Registration fee
          settings, applicant reviews, eligibility approvals, and kit
          fulfillment remain in the separate Registrar Management view.
        </p>
      </section>
    </div>
  );
}
