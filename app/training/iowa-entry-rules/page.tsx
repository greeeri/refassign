"use client";
import {useSearchParams} from "next/navigation";
import {Suspense} from "react";
import IowaRulesQuiz from "../../../components/IowaRulesQuiz";

function TestPage(){const params=useSearchParams(),moduleId=params.get("module")||"";if(!moduleId)return <main className="standaloneQuiz"><div className="errorBox">The training test link is incomplete.</div><button className="secondary" onClick={()=>history.back()}>Return to Training</button></main>;return <main className="standaloneQuiz"><IowaRulesQuiz moduleId={moduleId} onClose={()=>history.back()} onPassed={()=>{}}/></main>}
export default function Page(){return <Suspense fallback={<main className="standaloneQuiz">Loading test…</main>}><TestPage/></Suspense>}
