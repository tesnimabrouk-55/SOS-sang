-- Schema hospital: etablissements et urgences. Proprietaire: hospital-service.

CREATE TABLE IF NOT EXISTS hospitals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS urgences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  blood_group TEXT NOT NULL CHECK (blood_group IN ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  bags_needed INT NOT NULL CHECK (bags_needed BETWEEN 1 AND 50),
  bags_confirmed INT NOT NULL DEFAULT 0,
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','NORMAL')),
  deadline_at TIMESTAMPTZ NOT NULL,
  city TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  notes TEXT,
  radius_km INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COVERED','CLOSED','CANCELLED')),
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  covered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS urgences_hospital_idx ON urgences (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS urgences_open_idx ON urgences (status, blood_group) WHERE status IN ('OPEN','COVERED');

CREATE TABLE IF NOT EXISTS urgency_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urgency_id UUID NOT NULL REFERENCES urgences(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL,
  -- CONTACTED: alerte envoyee | COMING: a repondu oui | CONFIRMED: place reservee
  -- DECLINED: a repondu non | CANCELLED: place liberee
  status TEXT NOT NULL DEFAULT 'CONTACTED'
    CHECK (status IN ('CONTACTED','COMING','CONFIRMED','DECLINED','CANCELLED')),
  distance_km DOUBLE PRECISION,
  rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (urgency_id, donor_id)
);

CREATE INDEX IF NOT EXISTS urgency_responses_urgency_idx ON urgency_responses (urgency_id, status);

CREATE TABLE IF NOT EXISTS urgency_donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urgency_id UUID NOT NULL REFERENCES urgences(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL,
  bags INT NOT NULL DEFAULT 1,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
CREATE INDEX IF NOT EXISTS hospital_outbox_unpublished_idx ON outbox(created_at) WHERE published_at IS NULL;
