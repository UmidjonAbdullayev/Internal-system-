-- Marcus seed left hire_date null; CRM formatDate('') threw and blanked Drivers page.
update public.drivers
set hire_date = coalesce(hire_date, current_date),
    updated_at = now()
where hire_date is null;
