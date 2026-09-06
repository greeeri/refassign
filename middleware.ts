import {NextRequest,NextResponse} from "next/server";

export function middleware(request:NextRequest){
 const isTierPreview=process.env.VERCEL_ENV==="preview"&&process.env.VERCEL_GIT_COMMIT_REF==="feature/league-tier-foundation";
 if(!isTierPreview)return NextResponse.next();
 const path=request.nextUrl.pathname;
 if(path==="/tier-test"||path.startsWith("/_next/")||path.startsWith("/brand/")||path==="/favicon.ico")return NextResponse.next();
 if(path.startsWith("/api/"))return NextResponse.json({error:"This isolated preview does not permit production API access."},{status:403});
 return NextResponse.redirect(new URL("/tier-test",request.url));
}

export const config={matcher:["/((?!_next/static|_next/image).*)"]};
