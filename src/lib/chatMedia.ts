import { supabase } from './supabase';
import { uuidv4 } from './clientQueries';

/* ============ Chat media upload (mirrors the web chatMediaUpload contract) ============
   Uploads to the `chat-media` bucket at `{conversationId}/{messageId}-{filename}`
   (the first path segment is the conversation id, which the storage RLS scopes to
   participants), then returns a signed URL stored on the message. */

export type AttachmentKind = 'image' | 'video' | 'voice' | 'document';
const LIMIT_MB: Record<AttachmentKind, number> = { image: 10, video: 50, document: 20, voice: 10 };

export function kindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'document';
}

const SIGNED_URL_TTL = 365 * 24 * 60 * 60; // matches the web app (1 year) for cross-app interop

export type PickedAsset = { uri: string; name: string; mime: string; size?: number | null };

export async function uploadChatMedia(asset: PickedAsset, conversationId: string, messageId?: string): Promise<{ url: string; kind: AttachmentKind; size: number }> {
  const kind = kindFromMime(asset.mime);
  const size = asset.size ?? 0;
  const limit = (LIMIT_MB[kind] ?? 20) * 1024 * 1024;
  if (size && size > limit) throw new Error(`File too large. Max for ${kind} is ${LIMIT_MB[kind]}MB.`);

  const mid = messageId ?? uuidv4();
  const safeName = (asset.name || `${kind}.bin`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${conversationId}/${mid}-${safeName}`;

  // RN-safe upload: fetch the local uri → ArrayBuffer (blob() is unreliable on Hermes).
  const res = await fetch(asset.uri);
  const buf = await res.arrayBuffer();

  const { error } = await supabase.storage.from('chat-media').upload(path, buf, { contentType: asset.mime, upsert: false });
  if (error) throw new Error(error.message);

  const { data, error: se } = await supabase.storage.from('chat-media').createSignedUrl(path, SIGNED_URL_TTL);
  if (se || !data?.signedUrl) throw new Error(se?.message || 'Failed to create media URL');
  return { url: data.signedUrl, kind, size: size || buf.byteLength };
}
