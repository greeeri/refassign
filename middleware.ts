import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.hostname
  ).split(":")[0];
  const path = request.nextUrl.pathname;
  if (
    hostname === "test.ref-assign.com" &&
    (path === "/workspace" || path === "/login")
  )
    return NextResponse.next();
  const isTierPreview =
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "feature/league-tier-foundation";
  if (!isTierPreview) return NextResponse.next();
  if (
    path.startsWith("/tier-test") ||
    path === "/api/tier-test/team-invitation" ||
    path === "/api/tier-test/location-search" ||
    path === "/api/tier-test/official-invitations" ||
    path.startsWith("/_next/") ||
    path.startsWith("/brand/") ||
    path === "/favicon.ico"
  )
    return NextResponse.next();
  if (path.startsWith("/api/"))
    return NextResponse.json(
      { error: "This isolated preview does not permit production API access." },
      { status: 403 },
    );
  return NextResponse.redirect(new URL("/tier-test", request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
