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

const SUPABASE_URL = 'https://blgagbkgnxeqywzhlvrr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsZ2FnYmtnbnhlcXl3emhsdnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NDI4NTcsImV4cCI6MjEwNDQxODg1N30.HFSfSLqw6DgRwvncr7G24F_FU2XogzgLdKFLeIFd5hA';

// `supabase` here refers to the global created by the CDN script
// included in the HTML pages (@supabase/supabase-js).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

// Catches the single most common setup mistake — forgetting to replace
// the placeholder URL/key above — so it shows up as a clear console
// warning instead of a confusing "Failed to fetch" during sign-in.
const SUPABASE_CONFIGURED =
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  !SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY') &&
  SUPABASE_URL.startsWith('https://');

if (!SUPABASE_CONFIGURED) {
  console.warn(
    '[Roombook] SUPABASE_URL/SUPABASE_ANON_KEY in assets/js/supabaseClient.js still look like placeholders. ' +
    'Sign-in will fail until you paste in your real Project URL and anon key from Supabase → Project Settings → API.'
  );
}
