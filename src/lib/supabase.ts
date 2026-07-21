import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Values come from .env (EXPO_PUBLIC_* vars are inlined by Expo at build time).
// Never put the service_role key anywhere in this app.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — check .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// The trainer whose data the dashboard shows (dev only, until real auth-per-user).
// Khalid Ahmad — has recent training_sessions.
export const DEV_TRAINER_ID = process.env.EXPO_PUBLIC_TRAINER_ID ?? 'd3330fb2-9151-4c60-a370-ce5395edc830';
