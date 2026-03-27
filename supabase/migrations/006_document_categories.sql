-- Migrate document categories: rename brochure → launchpad
-- Run this against Supabase to update existing documents

UPDATE documents SET category = 'launchpad' WHERE category = 'brochure';
