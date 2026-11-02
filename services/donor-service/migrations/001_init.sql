-- Schema donor: profils des donneurs, disponibilite, historique, reponses aux alertes.

CREATE TABLE IF NOT EXISTS donors (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT NOT NULL,
  blood_group TEXT NOT NULL CHECK (blood_group IN ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  location_consent BOOLEAN NOT NULL DEFAULT false,
  notifications_consent BOOLEAN NOT NULL DEFAULT true,
  is_available BOOLEAN NOT NULL DEFAULT true,
  birth_date DATE,
  weight_kg NUMERIC(5,1),
  last_donation_date DATE,
  total_donations INT NOT NULL DEFAULT 0,
  alerts_received INT NOT NULL DEFAULT 0,
  alerts_answered INT NOT NULL DEFAULT 0,
  alerts_coming INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS donors_matching_idx
  ON donors (blood_group, is_available) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS donors_city_idx ON donors (city);

CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL,
  hospital_name TEXT NOT NULL,
  urgency_id UUID,
  donated_on DATE NOT NULL,
  bags INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS donations_donor_idx ON donations (donor_id, donated_on DESC);

CREATE TABLE IF NOT EXISTS alert_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  urgency_id UUID NOT NULL,
  hospital_id UUID NOT NULL,
  donor_id UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  answer TEXT NOT NULL CHECK (answer IN ('COMING','CANNOT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (urgency_id, donor_id)
);

CREATE INDEX IF NOT EXISTS alert_responses_donor_idx ON alert_responses (donor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

-- Idempotence des consommateurs et outbox transactionnelle du service.
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
CREATE INDEX IF NOT EXISTS donor_outbox_unpublished_idx ON outbox(created_at) WHERE published_at IS NULL;
