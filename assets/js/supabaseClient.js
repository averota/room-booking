// =====================================================================
// Supabase client setup
//
// Fill in your project's URL and anon (public) key below. Both values
// are safe to expose in front-end code — access is controlled by the
// Row Level Security policies in supabase/schema.sql, not by hiding
// this key.
//
// Find them in: Supabase Dashboard > Project Settings > API
// =====================================================================

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

// `supabase` here refers to the global created by the CDN script
// included in the HTML pages (@supabase/supabase-js).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
