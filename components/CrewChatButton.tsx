'use client'
import {useState} from 'react'
import CrewChat from './CrewChat'
export default function CrewChatButton({gameId,title}:{gameId:string;title:string}){const [open,setOpen]=useState(false);return <><button className="crewChatButton" type="button" onClick={()=>setOpen(true)}>💬 Crew Chat</button>{open&&<CrewChat gameId={gameId} title={title} onClose={()=>setOpen(false)}/>}</>}
