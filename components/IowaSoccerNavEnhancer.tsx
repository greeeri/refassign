"use client";
import { useEffect } from "react";

const IOWA_LOGO = "/api/assets/iowa-referee-development?v=30d46091";

export default function IowaSoccerNavEnhancer(){
  useEffect(()=>{
    const apply=()=>{
      const nav=document.querySelector<HTMLDivElement>("#primary-navigation nav");
      if(!nav) return;
      const existing=nav.querySelector<HTMLDivElement>(".iowaSoccerNavGroup");
      if(existing){
        const parent=existing.querySelector<HTMLButtonElement>(".iowaSoccerNavButton");
        if(parent && !parent.querySelector("img")) parent.insertAdjacentHTML("afterbegin",`<img src="${IOWA_LOGO}" alt="Iowa Soccer Referee Development Program"/>`);
        const img=parent?.querySelector<HTMLImageElement>("img"); if(img && img.src!==new URL(IOWA_LOGO,location.href).href) img.src=IOWA_LOGO;
        return;
      }
      const buttons=Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button"));
      const byText=(text:string)=>buttons.find(b=>b.textContent?.trim()===text);
      const registration=byText("Iowa Soccer Registration") || byText("Registration");
      const training=byText("Iowa Soccer Development");
      const referees=byText("Program Referees");
      const mentors=byText("Mentors") || byText("Mentor Center");
      const items=[registration,training,referees,mentors].filter(Boolean) as HTMLButtonElement[];
      if(!items.length) return;
      const group=document.createElement("div"); group.className="iowaSoccerNavGroup";
      const parent=document.createElement("button"); parent.type="button"; parent.className="iowaSoccerNavButton"; parent.setAttribute("aria-expanded","false");
      parent.innerHTML=`<img src="${IOWA_LOGO}" alt="Iowa Soccer Referee Development Program"/><span>Iowa Soccer</span><b>›</b>`;
      const children=document.createElement("div"); children.className="iowaSoccerNavChildren"; children.hidden=true;
      const labels=new Map<HTMLButtonElement,string>();
      if(registration) labels.set(registration,"Registration"); if(training) labels.set(training,"Training"); if(referees) labels.set(referees,"Program Referees"); if(mentors) labels.set(mentors,"Mentors");
      items.forEach(btn=>{btn.textContent=labels.get(btn)||btn.textContent; btn.classList.add("iowaSoccerChild"); children.appendChild(btn)});
      parent.onclick=()=>{const open=children.hidden; children.hidden=!open; parent.setAttribute("aria-expanded",String(open)); parent.querySelector("b")!.textContent=open?"⌄":"›"};
      group.append(parent,children); nav.appendChild(group);
    };
    apply(); const obs=new MutationObserver(apply); const nav=document.querySelector("#primary-navigation nav"); if(nav) obs.observe(nav,{childList:true,subtree:true}); return()=>obs.disconnect();
  },[]);
  return null;
}
