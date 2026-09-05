import { NextResponse } from "next/server";

export async function GET() {
  const base64 = process.env.IOWA_SOCCER_APPROVED_ICON || "";
  if (!base64) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(base64, "base64"), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
