import {NextRequest,NextResponse} from "next/server";
import {createServiceClient} from "../../../../lib/supabase/admin";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {IOWA_ENTRY_RULES_PASS_PERCENT,IOWA_ENTRY_RULES_QUIZ_KEY,iowaEntryRulesQuestions} from "../../../../lib/iowaEntryRulesQuiz";
import {iowaEntryRulesAnswers} from "../../../../lib/server/iowaEntryRulesQuizAnswers";

type QuizRequest={moduleId?:string;answers?:Record<string,string>};

export async function POST(request:NextRequest){
 const session=await createServerSupabaseClient(),{data:{user}}=await session.auth.getUser();
 if(!user)return NextResponse.json({error:"Please sign in to submit the test."},{status:401});
 const body=await request.json().catch(()=>({})) as QuizRequest,moduleId=body.moduleId,submitted=body.answers||{};
 if(!moduleId||typeof moduleId!=="string")return NextResponse.json({error:"The training module is missing."},{status:400});
 const service=createServiceClient();
 const{data:official}=await service.from("officials").select("id").eq("auth_user_id",user.id).eq("active",true).maybeSingle();
 if(!official)return NextResponse.json({error:"Your official profile could not be found."},{status:403});
 const{data:module}=await service.from("development_modules").select("id,program_id,quiz_key,active").eq("id",moduleId).eq("quiz_key",IOWA_ENTRY_RULES_QUIZ_KEY).maybeSingle();
 if(!module?.active)return NextResponse.json({error:"This test is not currently available."},{status:404});
 const{data:membership}=await service.from("registration_program_officials").select("official_id").eq("program_id",module.program_id).eq("official_id",official.id).maybeSingle();
 if(!membership)return NextResponse.json({error:"Iowa Soccer training access is required."},{status:403});
 const answers:Record<string,string>={};
 for(const question of iowaEntryRulesQuestions){const value=submitted[question.id];if(typeof value==="string"&&question.options.some(option=>option.value===value))answers[question.id]=value}
 if(Object.keys(answers).length!==iowaEntryRulesQuestions.length)return NextResponse.json({error:"Please answer all 25 questions before submitting."},{status:400});
 const results=iowaEntryRulesQuestions.map(question=>{const key=iowaEntryRulesAnswers[question.id],selected=answers[question.id];return{id:question.id,selected,correct:key.correct,isCorrect:selected===key.correct,explanation:key.explanation}}),correctCount=results.filter(result=>result.isCorrect).length,scorePercent=Math.round(correctCount/iowaEntryRulesQuestions.length*100),passed=scorePercent>=IOWA_ENTRY_RULES_PASS_PERCENT,completedAt=new Date().toISOString();
 const{error:attemptError}=await service.from("development_quiz_attempts").insert({module_id:module.id,official_id:official.id,quiz_key:IOWA_ENTRY_RULES_QUIZ_KEY,answers,correct_count:correctCount,total_questions:iowaEntryRulesQuestions.length,score_percent:scorePercent,passed,completed_at:completedAt});
 if(attemptError)return NextResponse.json({error:"Your score could not be saved. Please try again."},{status:500});
 const{data:existing}=await service.from("official_development_progress").select("status").eq("module_id",module.id).eq("official_id",official.id).maybeSingle();
 if(passed||existing?.status!=="completed")await service.from("official_development_progress").upsert({module_id:module.id,official_id:official.id,status:passed?"completed":"in_progress",completed_at:passed?completedAt:null,updated_at:completedAt});
 return NextResponse.json({correctCount,totalQuestions:iowaEntryRulesQuestions.length,scorePercent,passed,passPercent:IOWA_ENTRY_RULES_PASS_PERCENT,results});
}
