-- Provider-owned tables needed by application foreign keys and session reads.
-- This fixture does not claim to test the external identity provider itself.
CREATE SCHEMA neon_auth;
CREATE TABLE neon_auth."user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(), image text
);
CREATE TABLE neon_auth.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE,
  "userId" uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
