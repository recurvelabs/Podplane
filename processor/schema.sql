PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, token_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE podcasts (id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', artwork TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', last_sync INTEGER NOT NULL DEFAULT 0, last_error TEXT, etag TEXT, modified TEXT);
CREATE TABLE subscriptions (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, podcast_id TEXT NOT NULL REFERENCES podcasts(id), created_at INTEGER NOT NULL, PRIMARY KEY(account_id,podcast_id));
CREATE TABLE episodes (id TEXT PRIMARY KEY, podcast_id TEXT NOT NULL REFERENCES podcasts(id), guid TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL, published_at INTEGER NOT NULL, duration REAL NOT NULL DEFAULT 0, cleaned_duration REAL NOT NULL DEFAULT 0, audio_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0, cuts_json TEXT NOT NULL DEFAULT '[]', error TEXT, workflow_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, ready_at INTEGER, UNIQUE(podcast_id,guid));
CREATE INDEX episodes_podcast_date ON episodes(podcast_id,published_at DESC);
CREATE INDEX episodes_status ON episodes(status,created_at);
CREATE TABLE limits (key TEXT PRIMARY KEY, amount REAL NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE reservations (episode_id TEXT PRIMARY KEY, day TEXT NOT NULL, minutes REAL NOT NULL);
