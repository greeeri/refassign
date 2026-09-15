import type { Metadata } from "next";
import HelpCenter from "./HelpCenter";

export const metadata: Metadata = {
  title: "Help Center | Ref Pro Group",
  description: "Search Ref Pro Group frequently asked questions and download user guides and support documents.",
};

export default function HelpPage() { return <HelpCenter />; }
