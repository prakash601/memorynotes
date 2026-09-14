"use server";

import { revalidatePath } from "next/cache";
import { createApiToken, isDomainError, revokeApiToken } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";

export interface TokenActionResult {
  ok: boolean;
  secret?: string;
  message?: string;
}

export async function createTokenAction(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}): Promise<TokenActionResult> {
  const user = await requireUserOrRedirect();

  try {
    const { rawToken } = await createApiToken(getDb(), {
      userId: user.id,
      name: input.name,
      scopes: input.scopes,
      expiresAt:
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1_000)
          : null,
    });
    revalidatePath("/settings/tokens");
    return { ok: true, secret: rawToken };
  } catch (error) {
    return { ok: false, message: isDomainError(error) ? error.message : "Could not create token" };
  }
}

export async function revokeTokenAction(input: { tokenId: string }): Promise<TokenActionResult> {
  const user = await requireUserOrRedirect();

  try {
    await revokeApiToken(getDb(), { tokenId: input.tokenId, userId: user.id });
    revalidatePath("/settings/tokens");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: isDomainError(error) ? error.message : "Could not revoke token" };
  }
}
