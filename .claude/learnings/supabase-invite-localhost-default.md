---
id: supabase-invite-localhost-default
domain: supabase-auth
confidence: 0.3
created: 2026-04-03
confirmed: 0
---

# Supabase inviteUserByEmail defaults redirect to localhost

`inviteUserByEmail()` without a `redirectTo` parameter uses the first configured redirect URI in Supabase dashboard settings — which defaults to `http://localhost:3000`. Emails send successfully but links don't work in production.

For internal tools where admins control credentials, `admin.createUser({ email, password, email_confirm: true })` is simpler — skips the entire email delivery chain (no SMTP, no redirect URIs, no invite templates).
