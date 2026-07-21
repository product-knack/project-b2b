/* ============ Linked accounts (one human, two logins) ============
   The coach account and trainer Sagar Sharma are operated by the same person
   (Sagar). A toggle on BOTH dashboards swaps the Supabase session between them
   with one tap — credentials are built in (verified live 2026-07-15), no
   re-entry needed. */

export type LinkedAccount = { id: string; email: string; password: string; label: string; workspace: 'coach' | 'trainer' };

export const LINKED_ACCOUNTS: LinkedAccount[] = [
  { id: '3d04b08d-f723-4d21-b2bc-8bc82ebcd2f5', email: 'coach@oddsfitness.com', password: 'Coach@odds001', label: 'Coach', workspace: 'coach' },
  { id: '4b5c7679-c163-4060-b84d-d7753a51e695', email: 'sagaroddsfitness@gmail.com', password: 'Sagar07', label: 'Sagar Sharma', workspace: 'trainer' },
];

/* The OTHER linked account when uid is one of the pair; null for everyone else. */
export function counterpartOf(uid: string | null | undefined): LinkedAccount | null {
  if (!uid) return null;
  const idx = LINKED_ACCOUNTS.findIndex((a) => a.id === uid);
  return idx === -1 ? null : LINKED_ACCOUNTS[1 - idx];
}
