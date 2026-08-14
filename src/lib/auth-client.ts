"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { appUrl } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: appUrl(),
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
