-- Voce dei Clienti — schema iniziale (V1)
--
-- Catena di tracciabilità:
--   insights → analysis_runs → insight_evidence → review_signals → reviews → sources → businesses
--
-- Sicurezza: RLS attiva su tutte le tabelle e nessuna policy per anon/authenticated.
-- Solo il codice server (service role) legge e scrive. Il browser non accede mai al DB.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

create type review_platform as enum ('google', 'trustpilot', 'shopify', 'woocommerce', 'other');

create type run_status as enum (
  'queued',
  'resolving',
  'scraping',
  'importing',
  'extracting',
  'consolidating',
  'synthesizing',
  'completed',
  'failed'
);

create type signal_kind as enum (
  'purchase_driver',     -- perché ti scelgono
  'positive_driver',     -- cosa amano
  'pain_point',          -- cosa li delude
  'confusion',           -- cosa non capiscono
  'desire',              -- cosa vorrebbero (obiettivi, bisogni)
  'requested_feature',   -- cosa chiedono esplicitamente
  'unmet_expectation',   -- aspettative disattese
  'objection',           -- cosa potrebbe bloccare l'acquisto
  'customer_language'    -- parole usate per descriverti
);

create type insight_section as enum (
  'why_choose',
  'love',
  'disappoint',
  'confusion',
  'desires',
  'unmet_expectations',
  'objections',
  'language',
  'opportunity',
  'comparison'
);

create type recommendation_status as enum ('proposed', 'approved', 'rejected', 'executed');

-- ---------------------------------------------------------------------------
-- Attività e fonti
-- ---------------------------------------------------------------------------

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  address text,
  website_url text,                       -- futuro: Brand Promise Gap
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  platform review_platform not null,
  external_id text not null,              -- Google: placeId
  canonical_url text,
  platform_rating numeric(2,1),
  platform_review_count integer,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index sources_business_idx on sources(business_id);

-- ---------------------------------------------------------------------------
-- Recensioni normalizzate (schema unico per tutte le fonti)
-- ---------------------------------------------------------------------------

create table reviews (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_review_id text not null,
  author_display text,                    -- forma ridotta ("Marco R."), mai profilo/foto
  rating smallint not null check (rating between 1 and 5),
  text text,                              -- null se la recensione è solo un voto
  language text,
  review_date timestamptz,
  owner_reply_text text,
  owner_reply_date timestamptz,
  review_url text,
  content_hash text not null,             -- hash di rating + testo: cambia se la recensione cambia
  raw jsonb,                              -- sottoinsieme minimo del dato originale
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, external_review_id)
);
create index reviews_source_date_idx on reviews(source_id, review_date desc);

-- ---------------------------------------------------------------------------
-- Analisi
-- ---------------------------------------------------------------------------

create table analysis_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  source_id uuid references sources(id) on delete cascade,
  input_url text not null,
  resolved_url text,
  status run_status not null default 'queued',
  progress jsonb not null default '{}'::jsonb,   -- { found, extracted, toExtract, ... }
  error_code text,
  error_detail text,
  settings jsonb not null default '{}'::jsonb,   -- { maxReviews, sort }
  apify_run_id text,
  apify_dataset_id text,
  pipeline_version text not null,
  prompt_versions jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  summary jsonb,                                  -- panoramica calcolata dal codice
  token_usage jsonb not null default '{}'::jsonb,
  requester_hash text,                            -- hash IP per rate limiting, nessun IP in chiaro
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index analysis_runs_business_idx on analysis_runs(business_id, created_at desc);
create index analysis_runs_created_idx on analysis_runs(created_at desc);
create index analysis_runs_requester_idx on analysis_runs(requester_hash, created_at desc);

-- Campione di recensioni usato da un run
create table analysis_run_reviews (
  run_id uuid not null references analysis_runs(id) on delete cascade,
  review_id uuid not null references reviews(id) on delete cascade,
  primary key (run_id, review_id)
);
create index analysis_run_reviews_review_idx on analysis_run_reviews(review_id);

-- Estrazione AI per singola recensione — CACHE condivisa tra run.
-- Una recensione invariata (stesso content_hash) con la stessa versione di estrazione
-- non viene mai ri-analizzata.
create table review_extractions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  content_hash text not null,
  extraction_version text not null,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  model text,
  sentiment text check (sentiment in ('positive', 'mixed', 'negative', 'neutral')),
  sentiment_intensity smallint check (sentiment_intensity between 1 and 3),
  severity text check (severity in ('none', 'low', 'medium', 'high')),
  topics text[] not null default '{}',
  result jsonb,                         -- output validato completo
  created_at timestamptz not null default now(),
  unique (review_id, content_hash, extraction_version)
);

-- Segnali normalizzati: una riga per segnale, sempre con citazione verificata
create table review_signals (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references review_extractions(id) on delete cascade,
  review_id uuid not null references reviews(id) on delete cascade,
  kind signal_kind not null,
  topic text not null,                  -- tema "grezzo" estratto dall'AI
  label text not null,                  -- descrizione breve in italiano
  quote text not null,                  -- sottostringa verificata del testo originale
  quote_start integer,
  quote_end integer,
  severity text check (severity in ('none', 'low', 'medium', 'high'))
);
create index review_signals_extraction_idx on review_signals(extraction_id);
create index review_signals_review_idx on review_signals(review_id);

-- Temi canonici di un run (es. "Assistenza", "Consegna")
create table run_themes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references analysis_runs(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  unique (run_id, key)
);

create table signal_themes (
  run_id uuid not null references analysis_runs(id) on delete cascade,
  signal_id uuid not null references review_signals(id) on delete cascade,
  theme_id uuid not null references run_themes(id) on delete cascade,
  primary key (run_id, signal_id)
);
create index signal_themes_theme_idx on signal_themes(theme_id);

-- Insight aggregati
-- metrics: SOLO valori calcolati dal codice (conteggi, base, quota, rating medio, trend)
-- interpretation: SOLO testo AI, sempre separato dalle evidenze
create table insights (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references analysis_runs(id) on delete cascade,
  section insight_section not null,
  theme_id uuid references run_themes(id) on delete set null,
  title text not null,
  interpretation text,
  confidence text check (confidence in ('alta', 'media', 'bassa')),
  metrics jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,     -- dati extra per sezione (es. confronto)
  rank integer not null default 0,
  created_at timestamptz not null default now()
);
create index insights_run_idx on insights(run_id, section, rank);

create table insight_evidence (
  insight_id uuid not null references insights(id) on delete cascade,
  review_id uuid not null references reviews(id) on delete cascade,
  signal_id uuid references review_signals(id) on delete cascade,
  role text not null default 'supporting' check (role in ('supporting', 'contrasting')),
  primary key (insight_id, review_id, role)
);
create index insight_evidence_review_idx on insight_evidence(review_id);

-- ---------------------------------------------------------------------------
-- Moduli futuri (Migliora, ADV, Contenuti, Recupera cliente, Brand Promise Gap)
-- Principio: AI PROPONE → ESSERE UMANO APPROVA → SISTEMA ESEGUE
-- ---------------------------------------------------------------------------

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references analysis_runs(id) on delete cascade,
  module text not null check (module in ('improve', 'ad_angles', 'content', 'recovery', 'brand_gap')),
  payload jsonb not null,
  source_insight_ids uuid[] not null default '{}',
  source_review_ids uuid[] not null default '{}',
  status recommendation_status not null default 'proposed',
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
create index recommendations_run_idx on recommendations(run_id, module);

create table brand_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  claim text not null,
  theme_key text,
  source_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: tutto chiuso. Il service role (solo server) bypassa RLS.
-- ---------------------------------------------------------------------------

alter table businesses enable row level security;
alter table sources enable row level security;
alter table reviews enable row level security;
alter table analysis_runs enable row level security;
alter table analysis_run_reviews enable row level security;
alter table review_extractions enable row level security;
alter table review_signals enable row level security;
alter table run_themes enable row level security;
alter table signal_themes enable row level security;
alter table insights enable row level security;
alter table insight_evidence enable row level security;
alter table recommendations enable row level security;
alter table brand_claims enable row level security;

-- ---------------------------------------------------------------------------
-- Lock atomico per far avanzare un run (evita esecuzioni concorrenti)
-- ---------------------------------------------------------------------------

create or replace function claim_run(p_run_id uuid, p_lease_seconds integer)
returns setof analysis_runs
language sql
security definer
set search_path = public
as $$
  update analysis_runs
     set locked_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_run_id
     and status not in ('completed', 'failed')
     and (locked_until is null or locked_until < now())
  returning *;
$$;

revoke all on function claim_run(uuid, integer) from public, anon, authenticated;
grant execute on function claim_run(uuid, integer) to service_role;
