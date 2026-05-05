(function (window) {
  'use strict';

  const CONFIG = {
    SUPABASE_URL: 'https://hqdmyxxrskvllkcedybl.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZG15eHhyc2t2bGxrY2VkeWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzkxMDIsImV4cCI6MjA5MzExNTEwMn0.OsHmLXwgQvxxZ2MTCULxhYmDt3fMO6x9RXohn_eP1RM',
    STORAGE_BUCKET: 'gallery-uploads',
    POSTS_TABLE: 'gallery_posts',
    FAVORITES_TABLE: 'gallery_favorites'
  };

  function isConfigured() {
    return !!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY;
  }

  function getClient() {
    if (!window.supabase || !isConfigured()) return null;
    return window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );
  }

  window.LohasSupabase = {
    CONFIG,
    isConfigured,
    getClient
  };
})(window);
