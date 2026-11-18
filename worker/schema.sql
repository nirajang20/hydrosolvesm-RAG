CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  initials TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  affiliation TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT
);
CREATE TABLE IF NOT EXISTS ratings (
  participant_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 30),
  correctness INTEGER NOT NULL CHECK (correctness BETWEEN 1 AND 5),
  groundedness INTEGER NOT NULL CHECK (groundedness BETWEEN 1 AND 5),
  completeness INTEGER NOT NULL CHECK (completeness BETWEEN 1 AND 5),
  relevance INTEGER NOT NULL CHECK (relevance BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id, position),
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ratings_position ON ratings(position);
