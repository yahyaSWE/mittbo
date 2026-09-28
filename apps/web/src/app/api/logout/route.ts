import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin } from "@/lib/api";
import { clearWebSession, sameOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  await clearWebSession();
  return NextResponse.json({ ok: true });
}
