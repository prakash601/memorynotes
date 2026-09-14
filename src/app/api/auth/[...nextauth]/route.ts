import type { NextRequest } from "next/server";
import { getAuth } from "@/auth";

export async function GET(request: NextRequest) {
  return getAuth().handlers.GET(request);
}

export async function POST(request: NextRequest) {
  return getAuth().handlers.POST(request);
}
