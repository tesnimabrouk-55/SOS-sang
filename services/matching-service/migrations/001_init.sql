-- Schema matching: journal des calculs de selection (pas de donnees personnelles).
CREATE TABLE IF NOT EXISTS matching_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urgence_id UUID NOT NULL,
  blood_group TEXT NOT NULL,
  bags_needed INT NOT NULL,
  radius_km INT NOT NULL,
  candidates INT NOT NULL,
  selected INT NOT NULL,
  insufficient BOOLEAN NOT NULL DEFAULT false,
  duration_ms INT NOT NULL,
  excluded JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matching_runs_urgence_idx ON matching_runs (urgence_id, created_at DESC);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);
