-- Broadcast row changes to Supabase Realtime so clients can refresh the file list live.
-- If a line errors with "already exists", the table is already in the publication—safe to ignore.

alter publication supabase_realtime add table public.uploads;
alter publication supabase_realtime add table public.upload_files;
