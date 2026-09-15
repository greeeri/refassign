export type HelpFaq = { question: string; answer: string; category: string };
export type HelpDocument = { title: string; description: string; category: string; audience: string; format: "PDF"; href: string; updated: string };

export const helpFaqs: HelpFaq[] = [
  { category: "Signing in", question: "How do I sign in?", answer: "Go to ref-assign.com/login, enter the email address connected to your account and your password, then select Sign in." },
  { category: "Signing in", question: "What if I do not have a password yet?", answer: "Enter the email address connected to your account and select Email me a secure sign-in link. Open the email and follow the link to enter your workspace." },
  { category: "Signing in", question: "How do I reset a forgotten password?", answer: "Enter your account email address on the sign-in page, select Forgot password, and follow the instructions in the reset email. Check your spam or junk folder if it does not arrive." },
  { category: "Invitations", question: "Which email address should I use?", answer: "Use the exact email address that received your invitation or is listed on your official profile. Using a different address can create a separate account that is not connected to your organization." },
  { category: "Invitations", question: "My invitation or secure link expired. What should I do?", answer: "Return to the sign-in page, enter your email address and request a new secure sign-in link. If an organization invitation is no longer valid, contact your assignor or administrator to resend it." },
  { category: "Officials", question: "How do I respond to an assignment?", answer: "Open the assignment from your dashboard or assignment email, review the game details, and choose Accept or Decline. If you decline, provide a reason when requested." },
  { category: "Officials", question: "How do I update my availability?", answer: "Open Availability in your official workspace, choose the date and time you cannot work, add any needed details, and save the block." },
  { category: "Organizations", question: "Why can I not see an organization or league?", answer: "Confirm you signed in with the invited email address. If the organization still does not appear, ask its administrator to verify your connection and role access." },
  { category: "Organizations", question: "Can one account have more than one role?", answer: "Yes. The same account can hold multiple roles, such as official, assignor, administrator, mentor or registrar, when the organization grants that access." },
  { category: "Training", question: "Where do I find Iowa Soccer training and development?", answer: "After signing in, select Iowa Soccer in the workspace navigation, then open the Development area to view your levels, modules and progress." },
  { category: "Registration", question: "I am a new official. Where do I begin?", answer: "Select New official? Start registration on the sign-in page and complete the registration steps using the email address you plan to use for Ref Pro Group." },
  { category: "Mobile", question: "Can I use Ref Pro Group on my phone?", answer: "Yes. Open ref-assign.com in your phone's browser and sign in normally. The workspace adapts to mobile screens, so you can review and respond to assignments while away from a computer." },
];

export const helpDocuments: HelpDocument[] = [
  { title: "How to Sign In", description: "Step-by-step login instructions with screenshots, secure sign-in link guidance, password recovery and troubleshooting.", category: "Getting started", audience: "All users", format: "PDF", href: "/documents/ref-pro-group-login-guide.pdf", updated: "September 2026" },
];
