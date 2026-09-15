import { redirect } from "next/navigation";

export const metadata={title:"Ref Pro Group Workspace · Isolated Test"};

export default function TestWorkspacePage(){
 redirect("/workspace");
}
