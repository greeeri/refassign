"use client";

import { useState } from "react";
import TrainingCardQuiz from "./TrainingCardQuiz";

type Module = {
  id: string;
  title: string;
  description: string;
  category: string;
  resource_url: string | null;
};

export default function TournamentArTraining({ module }: { module: Module }) {
  const [quizOpen, setQuizOpen] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  if (quizOpen)
    return (
      <main className="standaloneQuiz tournamentArQuiz">
        <TrainingCardQuiz
          moduleId={module.id}
          onClose={() => setQuizOpen(false)}
          onPassed={setCompletedAt}
        />
      </main>
    );

  return (
    <main className="tournamentArPage">
      <section className="tournamentArCard">
        <span className="tournamentArEyebrow">IOWA REFEREE DEVELOPMENT</span>
        <h1>Tournament AR Training</h1>
        <p className="tournamentArIntro">
          Complete the focused assistant referee training and assessment without
          enrolling in the full development program.
        </p>
        <div className="tournamentArNotice">
          <b>No registration fee</b>
          <span>Your free RefAssign official account records your quiz score and completion.</span>
        </div>
        <article className="tournamentArModule">
          <div>
            <span>{module.category} · Self-led</span>
            <h2>{module.title}</h2>
            <p>{module.description}</p>
          </div>
          <div className="tournamentArActions">
            {module.resource_url && (
              <a className="trainingAction secondary" href={module.resource_url} target="_blank" rel="noreferrer">
                Open Training Material
              </a>
            )}
            <button className="trainingAction" onClick={() => setQuizOpen(true)}>
              Take the Quiz
            </button>
          </div>
        </article>
        {completedAt && (
          <div className="tournamentArComplete">
            ✓ Training completed {new Date(completedAt).toLocaleDateString()}. Your result has been saved.
          </div>
        )}
        <p className="tournamentArFootnote">
          This link provides Tournament AR training only. It does not enroll you
          in the full Iowa Referee Development program.
        </p>
      </section>
    </main>
  );
}
