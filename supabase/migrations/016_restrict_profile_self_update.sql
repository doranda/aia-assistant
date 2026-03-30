-- Restrict profile self-updates: users can only update their own full_name and avatar_url.
-- The old profiles_update_own policy allowed any authenticated user to update ANY column
-- on their own profile, including 'role'. This enabled privilege escalation via direct
-- Supabase API calls bypassing the Next.js team endpoint.

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

-- Create a restrictive policy: users can update their own profile but a trigger prevents role changes
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger to prevent non-service-role users from changing their own role or is_active
CREATE OR REPLACE FUNCTION prevent_self_role_change()
RETURNS TRIGGER AS $$
BEGIN
  -- service_role bypasses this check (admin operations via API routes)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Prevent role changes by authenticated users
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Cannot change own role via direct API';
  END IF;

  -- Prevent is_active changes by authenticated users
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    RAISE EXCEPTION 'Cannot change own active status via direct API';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_self_role_change_trigger ON profiles;
CREATE TRIGGER prevent_self_role_change_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_self_role_change();
