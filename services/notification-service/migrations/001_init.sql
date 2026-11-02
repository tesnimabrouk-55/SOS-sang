-- Schema notification: journal des envois (email / SMS simule / notification web).
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL,
  urgency_id UUID,
  type TEXT NOT NULL CHECK (type IN ('URGENT_NEED','NEED_COVERED','INFO')),
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WEB')),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_donor_idx ON notifications (donor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_status_idx ON notifications (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
  ON notifications (donor_id, urgency_id, type, channel) WHERE urgency_id IS NOT NULL;

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
