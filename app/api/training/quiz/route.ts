import {NextRequest,NextResponse} from "next/server";
import {createServiceClient} from "../../../../lib/supabase/admin";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";

type Submission={moduleId?:string;answers?:Record<string,number>};

async function context(moduleId:string){
 const session=await createServerSupabaseClient(),{data:{user}}=await session.auth.getUser();
 if(!user)return{error:NextResponse.json({error:"Please sign in to open this quiz."},{status:401})};
 const service=createServiceClient(),{data:official}=await service.from("officials").select("id").eq("auth_user_id",user.id).eq("active",true).maybeSingle();
 if(!official)return{error:NextResponse.json({error:"Your official profile could not be found."},{status:403})};
 const{data:module}=await service.from("development_modules").select("id,program_id,quiz_id,active").eq("id",moduleId).maybeSingle();
 if(!module?.active||!module.quiz_id)return{error:NextResponse.json({error:"This training card does not have an active quiz attached."},{status:404})};
 const{data:membership}=await service.from("registration_program_officials").select("official_id").eq("program_id",module.program_id).eq("official_id",official.id).maybeSingle();
 if(!membership)return{error:NextResponse.json({error:"Training access is required."},{status:403})};
 const[{data:quiz},{data:questions}]=await Promise.all([
  service.from("training_quizzes").select("id,title,description,passing_percent,allow_retakes,active").eq("id",module.quiz_id).eq("program_id",module.program_id).maybeSingle(),
  service.from("training_quiz_questions").select("id,question_text,options,correct_option,explanation,sort_order").eq("quiz_id",module.quiz_id).order("sort_order")
 ]);
 if(!quiz?.active||!questions?.length)return{error:NextResponse.json({error:"This quiz is not currently available."},{status:404})};
 return{service,official,module,quiz,questions};
}

export async function GET(request:NextRequest){
 const moduleId=request.nextUrl.searchParams.get("moduleId");
 if(!moduleId)return NextResponse.json({error:"The training card is missing."},{status:400});
 const result=await context(moduleId);if("error" in result)return result.error;
 const{service,official,module,quiz,questions}=result;
 const{data:attempt}=await service.from("development_quiz_attempts").select("correct_count,total_questions,score_percent,passed,completed_at").eq("module_id",module.id).eq("official_id",official.id).order("completed_at",{ascending:false}).limit(1).maybeSingle();
 return NextResponse.json({quiz:{id:quiz.id,title:quiz.title,description:quiz.description,passingPercent:quiz.passing_percent,allowRetakes:quiz.allow_retakes,questions:questions.map(q=>({id:q.id,question:q.question_text,options:q.options}))},latestAttempt:attempt?{correctCount:attempt.correct_count,totalQuestions:attempt.total_questions,scorePercent:attempt.score_percent,passed:attempt.passed,completedAt:attempt.completed_at}:null});
}

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>({})) as Submission;
 if(!body.moduleId)return NextResponse.json({error:"The training card is missing."},{status:400});
 const result=await context(body.moduleId);if("error" in result)return result.error;
 const{service,official,module,quiz,questions}=result,submitted=body.answers||{};
 if(!quiz.allow_retakes){const{data:prior}=await service.from("development_quiz_attempts").select("id").eq("module_id",module.id).eq("official_id",official.id).limit(1).maybeSingle();if(prior)return NextResponse.json({error:"This quiz allows one attempt only."},{status:409})}
 const answers:Record<string,number>={};
 for(const question of questions){const selected=submitted[question.id];if(Number.isInteger(selected)&&selected>=0&&selected<(question.options as unknown[]).length)answers[question.id]=selected}
 if(Object.keys(answers).length!==questions.length)return NextResponse.json({error:"Please answer every question before submitting."},{status:400});
 const results=questions.map(q=>({id:q.id,selected:answers[q.id],correct:q.correct_option,isCorrect:answers[q.id]===q.correct_option,explanation:q.explanation})),correctCount=results.filter(r=>r.isCorrect).length,scorePercent=Math.round(correctCount/questions.length*100),passed=scorePercent>=quiz.passing_percent,completedAt=new Date().toISOString();
 const{error:saveError}=await service.from("development_quiz_attempts").insert({module_id:module.id,official_id:official.id,quiz_id:quiz.id,quiz_key:`custom:${quiz.id}`,answers,correct_count:correctCount,total_questions:questions.length,score_percent:scorePercent,passed,completed_at:completedAt});
 if(saveError)return NextResponse.json({error:"Your quiz answers could not be saved. Please try again."},{status:500});
 const{data:existing}=await service.from("official_development_progress").select("status").eq("module_id",module.id).eq("official_id",official.id).maybeSingle();
 if(passed||existing?.status!=="completed")await service.from("official_development_progress").upsert({module_id:module.id,official_id:official.id,status:passed?"completed":"in_progress",completed_at:passed?completedAt:null,updated_at:completedAt});
 return NextResponse.json({correctCount,totalQuestions:questions.length,scorePercent,passed,passPercent:quiz.passing_percent,results});
}
