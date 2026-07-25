-- Per-member opt-in for "client requested changes" emails, toggled in
-- Settings → Team (✉ Notify). Default off; seed the workspace Owner as on so
-- notifications still reach someone out of the box.
alter table public.profiles
  add column if not exists notify_change_requests boolean not null default false;

update public.profiles set notify_change_requests = true where role = 'Owner';
