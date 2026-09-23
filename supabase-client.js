// Supabase project connection. The anon key below is meant to be public in client-side code —
// Supabase's security model relies on Row Level Security (see supabase/schema.sql), not on this
// key being secret. Never put the "service_role" key here or anywhere else in this app; it
// bypasses Row Level Security entirely.
(function () {
  const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
