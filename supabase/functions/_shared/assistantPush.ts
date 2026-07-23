// Shared FCM/Expo push helper for the AI Personal Assistant edge functions.
// Deliberately stripped down vs send-chat-notification — single recipient, single payload.

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };
  const encode = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const bin = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", bin, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${b64}`,
  });
  const j = await tokenRes.json();
  if (!j.access_token) throw new Error(`FCM token error: ${JSON.stringify(j)}`);
  return j.access_token;
}

interface PushTarget {
  id: string;
  token: string;
  platform: string;
}

async function sendToTokens(opts: {
  supabase: any;
  tokens: PushTarget[];
  title: string;
  body: string;
  data: Record<string, string>;
  invalidTable: "device_tokens" | "odds_device_tokens";
  channelId?: string; // Android notification channel (custom vibration/sound)
}): Promise<{ success: number; failure: number; errors?: string[] }> {
  const { supabase, tokens, title, body, data, invalidTable, channelId } = opts;
  const errors: string[] = [];

  if (!tokens || tokens.length === 0) {
    return { success: 0, failure: 0 };
  }

  const expoTokens: PushTarget[] = [];
  const fcmTokens: PushTarget[] = [];
  for (const t of tokens) {
    if (t.token.startsWith("ExponentPushToken[") || t.token.startsWith("ExpoPushToken[")) {
      expoTokens.push(t);
    } else {
      fcmTokens.push(t);
    }
  }

  let success = 0;
  let failure = 0;
  const invalidIds: string[] = [];

  // Expo
  if (expoTokens.length > 0) {
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          expoTokens.map((t) => ({
            to: t.token,
            title,
            body,
            data: { ...data, type: data.type || "assistant" },
            sound: "default",
            priority: "high",
            channelId: channelId || undefined,
          })),
        ),
      });
      const json = await res.json();
      const tickets = json.data || [];
      tickets.forEach((tk: any, i: number) => {
        if (tk.status === "ok") success++;
        else {
          failure++;
          if (tk.details?.error === "DeviceNotRegistered") {
            invalidIds.push(expoTokens[i].id);
          }
        }
      });
    } catch (e) {
      console.error("[assistantPush] expo error:", e);
      failure += expoTokens.length;
    }
  }

  // FCM
  if (fcmTokens.length > 0) {
    const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!saRaw) {
      console.warn("[assistantPush] FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping FCM tokens");
      failure += fcmTokens.length;
    } else {
      try {
        const sa = JSON.parse(saRaw) as ServiceAccount;
        const accessToken = await getAccessToken(sa);
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

        const results = await Promise.allSettled(
          fcmTokens.map(async (dt) => {
            const payload = {
              message: {
                token: dt.token,
                notification: { title, body },
                data: { ...data, title, body, type: data.type || "assistant" },
                android: {
                  priority: "high",
                  notification: {
                    channel_id: channelId || "assistant",
                    click_action: "FCM_PLUGIN_ACTIVITY",
                    sound: "default",
                  },
                },
                apns: {
                  headers: { "apns-priority": "10", "apns-push-type": "alert" },
                  payload: {
                    aps: { "content-available": 1, "mutable-content": 1, sound: "default" },
                  },
                },
              },
            };
            const res = await fetch(fcmUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const t = await res.text();
              const prefix = dt.token.slice(0, 20);
              console.error(`[assistantPush] FCM error ${res.status} for ${dt.platform} token ${prefix}…: ${t}`);
              errors.push(`FCM ${res.status} ${dt.platform} ${prefix}: ${t.slice(0, 300)}`);
              if (t.includes("UNREGISTERED") || t.includes("NOT_FOUND")) {
                invalidIds.push(dt.id);
              }
              throw new Error(`FCM ${res.status}`);
            }
            await res.text();
            return true;
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled") success++;
          else failure++;
        }
      } catch (e) {
        console.error("[assistantPush] FCM batch error:", e);
        errors.push(`FCM batch error: ${String(e)}`);
        failure += fcmTokens.length;
      }
    }
  }

  if (invalidIds.length > 0) {
    await supabase.from(invalidTable).delete().in("id", invalidIds);
  }

  return { success, failure, errors: errors.length ? errors : undefined };
}

export async function pushToClient(opts: {
  supabase: any;
  clientId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<{ success: number; failure: number; errors?: string[] }> {
  const { supabase, clientId, title, body, data = {} } = opts;

  // Client (B2C) push tokens live in `device_tokens` keyed by client_id.
  const { data: tokens, error } = await supabase
    .from("device_tokens")
    .select("id, token, platform")
    .eq("client_id", clientId);

  if (error || !tokens || tokens.length === 0) {
    return { success: 0, failure: 0 };
  }

  return sendToTokens({
    supabase,
    tokens: tokens as PushTarget[],
    title,
    body,
    data,
    invalidTable: "device_tokens",
  });
}

export async function pushToStaff(opts: {
  supabase: any;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  channelId?: string;
}): Promise<{ success: number; failure: number; errors?: string[] }> {
  const { supabase, userId, title, body, data = {}, channelId } = opts;

  // Staff (B2B) push tokens live in `odds_device_tokens` keyed by user_id.
  const { data: tokens, error } = await supabase
    .from("odds_device_tokens")
    .select("id, token, platform")
    .eq("user_id", userId);

  if (error || !tokens || tokens.length === 0) {
    return { success: 0, failure: 0 };
  }

  return sendToTokens({
    supabase,
    tokens: tokens as PushTarget[],
    title,
    body,
    data,
    channelId,
    invalidTable: "odds_device_tokens",
  });
}
