-- Ticket validation must see the assigned worker even when a tenant updates
-- their own ticket. The write guard and RLS still control who may update it.
alter function private.validate_ticket_refs() security definer;

-- Check the candidate row directly. The previous helper re-read tickets from
-- a STABLE function, which cannot see a row inserted by the same statement's
-- RETURNING clause and caused valid INSERT ... RETURNING calls to fail.
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets for select to authenticated
  using (organization_id = (select private.actor_org()) and (
    (select private.actor_role()) = 'admin'
    or (select private.actor_role()) = 'tenant' and tenant_id = (select auth.uid())
    or (select private.actor_role()) = 'worker' and assignee_id = (select auth.uid())
  ));
