import { redirect } from "next/navigation";

export const metadata={title:"RefAssign Workspace · Isolated Test"};

export default function TestWorkspacePage(){
 redirect("/workspace");
}
