import { NextRequest, NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardForUser } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const identity = await getCurrentUser(request);
    if (!identity) return unauthorized();
    return NextResponse.json(await getDashboardForUser(identity.db, identity.user));
  } catch (error) { return serverError(error); }
}
