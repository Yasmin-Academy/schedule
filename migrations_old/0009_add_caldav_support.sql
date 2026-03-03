-- Add CalDAV support fields to bookings
ALTER TABLE bookings ADD COLUMN caldav_event_url TEXT;
ALTER TABLE bookings ADD COLUMN caldav_uid TEXT;
