ALTER TABLE podcasts ADD COLUMN directory_id TEXT;
ALTER TABLE podcasts ADD COLUMN chart_rank INTEGER;
ALTER TABLE podcasts ADD COLUMN chart_updated_at INTEGER;
CREATE UNIQUE INDEX podcasts_directory_id ON podcasts(directory_id) WHERE directory_id IS NOT NULL;
CREATE INDEX podcasts_chart_rank ON podcasts(public_catalog,chart_rank);
