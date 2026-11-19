ALTER TABLE episodes ADD COLUMN publication_seq INTEGER NOT NULL DEFAULT 0;
CREATE TABLE missed_ad_reports (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  source_etag TEXT NOT NULL,
  position_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','fixed','unconfirmed','failed','closed')),
  created_at INTEGER NOT NULL,
  next_check INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  failure TEXT,
  result_version INTEGER,
  PRIMARY KEY (episode_id, version)
);
CREATE INDEX missed_ad_work ON missed_ad_reports(status, next_check, created_at);
