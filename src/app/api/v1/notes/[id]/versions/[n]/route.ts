import { NextResponse } from "next/server";
import { ValidationError, getVersion } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { problemResponse } from "@/lib/http";
import { serializeVersionDetail } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; n: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:read");
    const { id, n } = await context.params;
    const versionNumber = Number(n);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new ValidationError("Version number must be a positive integer");
    }

    const version = await getVersion(getDb(), id, principal.userId, versionNumber);
    return NextResponse.json(serializeVersionDetail(version));
  } catch (error) {
    return problemResponse(error);
  }
}
