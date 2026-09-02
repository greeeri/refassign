import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CalendarRow = {
  id:string;status:string;assigned_at:string;position_name:string|null;game_id:string;game_number:string|null;game_status:string;starts_at:string;duration_minutes:number;notes:string|null;home_name:string|null;away_name:string|null;location_name:string|null;location_address:string|null;location_city:string|null;location_state:string|null;league_name:string|null;level_name:string|null;
};
const escapeIcs=(value:unknown)=>String(value??"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
const icsDate=(value:string|Date)=>new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
const fold=(line:string)=>line.match(/.{1,73}/g)?.join("\r\n ")??"";

export async function GET(_request:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))return new NextResponse("Calendar not found.",{status:404});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await supabase.rpc("get_official_calendar_feed",{p_token:token});
  if(error)return new NextResponse("Unable to build calendar.",{status:500});
  if(data===null)return new NextResponse("Calendar not found.",{status:404});
  const rows=(data||[]) as CalendarRow[];
  const events=rows.flatMap(row=>{
    const canceled=["canceled","rained_out"].includes(row.game_status)||row.status==="cancelled",start=new Date(row.starts_at),end=new Date(start.getTime()+(row.duration_minutes||110)*60_000),location=[row.location_name,row.location_address,row.location_city,row.location_state].filter(Boolean).join(", "),summary=`${canceled?"CANCELLED — ":""}${row.home_name||"TBD"} vs ${row.away_name||"TBD"}`,description=[`Game ${row.game_number||"—"}`,row.position_name||"Official",row.league_name,row.level_name,row.notes].filter(Boolean).join(" • "),mapQuery=[row.location_address,row.location_city,row.location_state].filter(Boolean).join(", ")||row.location_name||"";
    return [
      "BEGIN:VEVENT",`UID:${row.id}@refassign`,`DTSTAMP:${icsDate(row.assigned_at||new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${escapeIcs(summary)}`,`LOCATION:${escapeIcs(location)}`,`DESCRIPTION:${escapeIcs(description)}`,`URL:${escapeIcs(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`)}`,`STATUS:${canceled?"CANCELLED":"CONFIRMED"}`,"TRANSP:OPAQUE","END:VEVENT"
    ];
  });
  const body=["BEGIN:VCALENDAR","VERSION:2.0","CALSCALE:GREGORIAN","METHOD:PUBLISH","PRODID:-//RefAssign//Official Schedule//EN","X-WR-CALNAME:RefAssign Schedule","X-PUBLISHED-TTL:PT15M","REFRESH-INTERVAL;VALUE=DURATION:PT15M",...events,"END:VCALENDAR"].map(fold).join("\r\n");
  return new NextResponse(body,{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"inline; filename=refassign-schedule.ics","Cache-Control":"public, max-age=300, s-maxage=300, stale-while-revalidate=60"}});
}
