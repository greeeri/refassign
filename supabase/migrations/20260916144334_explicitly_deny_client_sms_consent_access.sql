create policy "No client access to SMS consent status"
on public.sms_consent_status for all to anon,authenticated
using (false)
with check (false);
