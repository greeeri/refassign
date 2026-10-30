import * as XLSX from 'xlsx';
import {downloadJuscReport} from '../lib/server/playmetrics.ts';
if(process.env.VERCEL_ENV!=='preview')throw Error('Preview only');
for(const filename of ['teams.csv','team_schedules.csv']){
 try{
  const csv=await downloadJuscReport(filename);
  const book=XLSX.read(csv,{type:'string',raw:true});
  const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:'',raw:true});
  const headers=Object.keys(rows[0]||{});
  const keys=filename==='teams.csv'?['team_id','season','name','gender','level','birth_year']:['date','start_time','end_time','event','team_name','location','field_identifier','address'];
  const sample=rows.slice(0,5).map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])));
  console.log('JUSC_MAPPING_REPORT '+JSON.stringify({filename,rows:rows.length,headers,sample}));
 }catch(e){console.log('JUSC_MAPPING_REPORT '+JSON.stringify({filename,error:e.message}));}
}
