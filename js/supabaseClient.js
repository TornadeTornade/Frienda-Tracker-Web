// Instance unique du client Supabase, réutilisée par toutes les pages.
window.sb = supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
