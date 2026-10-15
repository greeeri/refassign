import {downloadJuscGames} from "../lib/server/playmetrics.ts";
if(process.env.VERCEL_ENV!=="preview"||!process.argv.includes("--apply")) throw Error("Preview only");
const expected=new Set(["5011376","5011377","5011379","5011380","5011381","5011382","5011383","5011384","5011386","5011387","5011388","5011389","5011390","5011391","5011392","5011394","5011395","5011396","5011481","5011483","5011485","5011487","5011489","5011491","5011494","5011496","5011498","5011499","5011500","5011501","5011502","5011503","5011504","5011505","5011506","5011507","5011508","5011509","5011570","5011571","5011572","5011573","5011574","5011576","5011577","5011578","5011579","5011580","5011581","5011582","5011583","5011584","5011585","5011586","5011587","5011588","5011589","5011590","5011673","5011674","5011676","5011677","5011678","5011679","5011680","5011681","5011683","5011684","5011685","5011686","5011687","5011689","5011690","5011691","5011692","5011693","5011694","5011695","5011696","5011697","5011698","5011699","5011700","5011701"]);
const feed=(await downloadJuscGames()).filter(x=>expected.has(x.id));
if(feed.length!==84) throw Error("Live feed matched "+feed.length+" of 84 expected game IDs; no writes applied");
const base=process.env.NEXT_PUBLIC_SUPABASE_URL+"/rest/v1";
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+process.env.SUPABASE_SERVICE_ROLE_KEY};
async function request(path,options={}){const r=await fetch(base+path,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error("Database request failed "+r.status);const s=await r.text();return s?JSON.parse(s):null;}
const games=await request("/games?league_id=eq.7ebefc42-8821-4c73-8954-b99ac9765781&source_system=eq.playmetrics&select=id,source_match_id,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations!games_location_id_fkey(name)");
const locations=await request("/locations?select=id,name");
let refreshed=0,changed=0,mappingIssues=0,canceled=0;
for(const f of feed){
const g=games.find(x=>x.source_match_id===f.id);if(!g)throw Error("Imported game missing");
const m=f.time.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/i);if(!m)throw Error("Invalid source time");
const hour=(Number(m[1])%12)+(m[3].toUpperCase()==="PM"?12:0);
if(!["2026-10-17","2026-10-24"].includes(f.date))throw Error("Unexpected live date requires timezone review");
const instant=new Date(f.date+"T"+String(hour).padStart(2,"0")+":"+m[2]+":00-05:00").toISOString();
const patch={source_synced_at:new Date().toISOString()};
if(g.home.name!==f.home||g.away.name!==f.away){mappingIssues++;patch.status="suspended";patch.calendar_needs_review=true;patch.notes="IMPORT HOLD: Live PlayMetrics team names changed. Home: "+f.home+"; Away: "+f.away+". Assignor review required.";}
if(new Date(g.starts_at).toISOString()!==instant){patch.starts_at=instant;patch.calendar_needs_review=true;patch.status="suspended";}
if(g.location.name!==f.field){const location=locations.find(x=>x.name===f.field);if(location)patch.location_id=location.id;else mappingIssues++;patch.status="suspended";patch.calendar_needs_review=true;patch.notes="IMPORT HOLD: PlayMetrics field changed to "+f.field+". Verify location and address.";}
if(f.cancelled){canceled++;patch.status="canceled";patch.calendar_needs_review=true;}
if(Object.keys(patch).length>1)changed++;
await request("/games?id=eq."+g.id,{method:"PATCH",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(patch)});refreshed++;
}
console.log("JUSC_MANUAL_SYNC "+JSON.stringify({ok:true,liveMatched:feed.length,refreshed,changed,mappingIssues,canceled,scope:"84 Discovery games",keyAuthentication:"passed",bucketDownload:"passed"}));
