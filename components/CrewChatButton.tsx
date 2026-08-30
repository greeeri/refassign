'use client'
import {useState} from 'react'
import CrewChat from './CrewChat'
export default function CrewChatButton({gameId,title}:{gameId:string;title:string}){const [open,setOpen]=useState(false);return <><button type="button" onClick={()=>setOpen(true)} style={{border:'1px solid #2563eb',background:'#2563eb',color:'#fff',borderRadius:7,padding:'6px 10px',fontWeight:800,cursor:'pointer'}}>💬 Crew Chat</button>{open&&<CrewChat gameId={gameId} title={title} onClose={()=>setOpen(false)}/>}</>}
