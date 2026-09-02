import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CalendarRow = {
  id:string; status:string; assigned_at:string; position:{name:string}|null;
  game:{id:string;game_number:string|null;status:string;starts_at:string;duration_minutes:number;notes:string|null;home:{name:string}|null;away:{name:string}|null;location:{name:string;address:string|null;city:string|null;state:string|null}|null;league:{name:string}|null;level:{name:string}|null}|null;
};
const escapeIcs=(value:unknown)=>String(value??"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
const icsDate=(value:string|Date)=>new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
const fold=(line:string)=>line.match(/.{1,73}/g)?.join("\r\n ")??"";

export async function GET(_request:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey)return new NextResponse("Calendar service is unavailable.",{status:503});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:calendar}=await supabase.from("official_calendar_tokens").select("official_id").eq("token",token).maybeSingle();
  if(!calendar)return new NextResponse("Calendar not found.",{status:404});
  const {data,error}=await supabase.from("assignments").select("id,status,assigned_at,position:sport_positions(name),game:games(id,game_number,status,starts_at,duration_minutes,notes,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,address,city,state),league:leagues(name),level:levels(name))").eq("official_id",calendar.official_id).not("published_at","is",null).gte("games.starts_at",new Date(Date.now()-90*86_400_000).toISOString()).order("assigned_at");
  if(error)return new NextResponse("Unable to build calendar.",{status:500});
  const events=((data||[]) as unknown as CalendarRow[]).flatMap(row=>{
    const game=row.game;if(!game)return[];
    const canceled=["canceled","rained_out"].includes(game.status)||row.status==="cancelled",start=new Date(game.starts_at),end=new Date(start.getTime()+(game.duration_minutes||110)*60_000),location=[game.location?.name,game.location?.address,game.location?.city,game.location?.state].filter(Boolean).join(", "),summary=`${canceled?"CANCELLED — ":""}${game.home?.name||"TBD"} vs ${game.away?.name||"TBD"}`,description=[`Game ${game.game_number||"—"}`,row.position?.name||"Official",game.league?.name,game.level?.name,game.notes].filter(Boolean).join(" • "),mapQuery=[game.location?.address,game.location?.city,game.location?.state].filter(Boolean).join(", ")||game.location?.name||"";
    return [
      "BEGIN:VEVENT",`UID:${row.id}@refassign`,`DTSTAMP:${icsDate(row.assigned_at||new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${escapeIcs(summary)}`,`LOCATION:${escapeIcs(location)}`,`DESCRIPTION:${escapeIcs(description)}`,`URL:${escapeIcs(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`)}`,`STATUS:${canceled?"CANCELLED":"CONFIRMED"}`,"TRANSP:OPAQUE","END:VEVENT"
    ];
  });
  const body=["BEGIN:VCALENDAR","VERSION:2.0","CALSCALE:GREGORIAN","METHOD:PUBLISH","PRODID:-//RefAssign//Official Schedule//EN","X-WR-CALNAME:RefAssign Schedule","X-PUBLISHED-TTL:PT15M","REFRESH-INTERVAL;VALUE=DURATION:PT15M",...events,"END:VCALENDAR"].map(fold).join("\r\n");
  return new NextResponse(body,{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"inline; filename=refassign-schedule.ics","Cache-Control":"public, max-age=300, s-maxage=300, stale-while-revalidate=60"}});
}
