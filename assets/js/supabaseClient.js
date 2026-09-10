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

// "Remember me" support: the login page writes 'rb_remember_session' to
// localStorage right before calling signInWithPassword ('1' = keep me
// signed in across browser restarts, '0' = forget me when the tab/browser
// closes). This client is only created once when the page loads, so
// instead of picking localStorage/sessionStorage once up front, we use a
// small adapter that checks the flag on every read/write. That way the
// choice made on THIS sign-in takes effect immediately, not just on the
// next one. If the flag hasn't been set yet (first-ever visit), we default
// to localStorage so behavior matches the previous "always persist" setup.
const authStorage = {
  getItem: (key) => {
    const remembered = localStorage.getItem('rb_remember_session');
    return remembered === '0' ? sessionStorage.getItem(key) : localStorage.getItem(key);
  },
  setItem: (key, value) => {
    const remembered = localStorage.getItem('rb_remember_session');
    if (remembered === '0') {
      sessionStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

// `supabase` here refers to the global created by the CDN script
// included in the HTML pages (@supabase/supabase-js).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: authStorage
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
