export function crewPositionLabel(position?:string|null){
 const p=(position||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'')
 if(p==='referee'||p==='centerreferee'||p==='center'||p==='cr')return 'Referee'
 if(p==='ar1'||p==='assistantreferee1'||p==='assistant1')return 'AR1'
 if(p==='ar2'||p==='assistantreferee2'||p==='assistant2')return 'AR2'
 if(p==='4thofficial'||p==='fourthofficial'||p==='4th'||p==='fourth')return '4th Official'
 if(p==='mentor')return 'Mentor'
 return position||'Official'
}
export function crewPositionOrder(position?:string|null){
 const label=crewPositionLabel(position)
 if(label==='Referee')return 0
 if(label==='AR1')return 1
 if(label==='AR2')return 2
 if(label==='4th Official')return 3
 if(label==='Mentor')return 4
 return 5
}
export function orderedCrew<T extends {position?:string|null}>(crew:T[]){return [...crew].sort((a,b)=>crewPositionOrder(a.position)-crewPositionOrder(b.position)||crewPositionLabel(a.position).localeCompare(crewPositionLabel(b.position)))}
