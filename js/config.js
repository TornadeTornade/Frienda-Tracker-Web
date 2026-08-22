// ⚠️ Ce fichier est PUBLIC (envoyé au navigateur). N'y mets JAMAIS la clé
// "service_role" de Supabase, seulement la clé "anon" (lecture seule grâce
// aux policies RLS définies dans sql/schema.sql).

window.APP_CONFIG = {
  SUPABASE_URL: "https://llremmfwgvqjuvijvhqz.supabase.co",
  SUPABASE_ANON_KEY : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxscmVtbWZ3Z3ZxanV2aWp2aHF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDU3NDEsImV4cCI6MjEwMjkyMTc0MX0.DDXYD_G4lKvLKDefH3QUFItKleGPmOPb6i_Q7Fmv37o",
  SERVER_NAME: "Frienda",
  SERVER_IP: "frienda.exaroton.me",

  // Rafraîchissement auto de certaines pages (ms)
  REFRESH_INTERVAL_MS: 30000,
};
