-- New permission "appointments.checkin": check a patient in without full
-- appointment editing. Give it to existing nurse roles (they receive patients)
-- and to organization admins (so they can grant it to other roles).
UPDATE "Role"
   SET permissions = array_append(permissions, 'appointments.checkin')
 WHERE key IN ('nurse', 'tenant_admin')
   AND NOT ('appointments.checkin' = ANY(permissions));
