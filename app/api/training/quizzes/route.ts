import {NextRequest,NextResponse} from "next/server";
import {createServiceClient} from "../../../../lib/supabase/admin";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";

type Question={question_text?:string;options?:string[];correct_option?:number;explanation?:string};
type QuizBody={programId?:string;title?:string;description?:string;passingPercent?:number;allowRetakes?:boolean;questions?:Question[]};

export async function POST(request:NextRequest){
 const session=await createServerSupabaseClient(),{data:{user}}=await session.auth.getUser();
 if(!user)return NextResponse.json({error:"Please sign in again before saving the quiz."},{status:401});
 const body=await request.json().catch(()=>({})) as QuizBody,programId=body.programId,title=body.title?.trim(),questions=body.questions||[],passingPercent=Number(body.passingPercent);
 if(!programId||!title)return NextResponse.json({error:"Quiz title and training program are required."},{status:400});
 if(!Number.isInteger(passingPercent)||passingPercent<1||passingPercent>100)return NextResponse.json({error:"Passing score must be between 1 and 100%."},{status:400});
 const clean=questions.map(q=>({question_text:q.question_text?.trim()||"",options:(q.options||[]).map(x=>x.trim()).filter(Boolean),correct_option:Number(q.correct_option),explanation:q.explanation?.trim()||""}));
 if(!clean.length||clean.some(q=>!q.question_text||q.options.length<2||q.options.length>6||!Number.isInteger(q.correct_option)||q.correct_option<0||q.correct_option>=q.options.length))return NextResponse.json({error:"Each question needs text, 2–6 answer choices, and one correct answer."},{status:400});
 const{data:allowed,error:accessError}=await session.rpc("can_manage_registration_program",{p_program_id:programId});
 if(accessError||!allowed)return NextResponse.json({error:"Your account does not have permission to manage quizzes for this training program."},{status:403});
 const service=createServiceClient(),{data:quiz,error:quizError}=await service.from("training_quizzes").insert({program_id:programId,title,description:body.description?.trim()||"",passing_percent:passingPercent,allow_retakes:body.allowRetakes!==false,created_by:user.id}).select("id").single();
 if(quizError||!quiz)return NextResponse.json({error:quizError?.message||"The quiz could not be created."},{status:500});
 const{error:questionError}=await service.from("training_quiz_questions").insert(clean.map((q,index)=>({...q,quiz_id:quiz.id,sort_order:index*10+10})));
 if(questionError){await service.from("training_quizzes").delete().eq("id",quiz.id);return NextResponse.json({error:questionError.message},{status:500})}
 return NextResponse.json({id:quiz.id,message:"Quiz saved to the repository."},{status:201});
}
