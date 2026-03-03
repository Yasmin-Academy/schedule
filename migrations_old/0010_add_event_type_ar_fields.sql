-- Add Arabic fields for event and host names (used on public booking page)
ALTER TABLE event_types ADD COLUMN name_ar TEXT;
ALTER TABLE event_types ADD COLUMN host_name_ar TEXT;
