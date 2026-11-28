CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN claim_code_expires_at TEXT;

ALTER TABLE members ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_project_user
  ON members(project_id, user_id)
  WHERE user_id IS NOT NULL;

INSERT OR IGNORE INTO users (id, email, display_name, password_hash) VALUES
  ('user-demo-owner', 'owner@ktconsole.dev', 'Alex Morgan', 'pbkdf2_sha256$100000$11111111111111111111111111111111$c6286fb2c315d591a8bf75eaf6724322570fd159761db0917e4244358f785890'),
  ('user-demo-member', 'member@ktconsole.dev', 'Sam Rivera', 'pbkdf2_sha256$100000$22222222222222222222222222222222$9b26aff5693303ac64c537110601826cb76193d2da42531ddbcc224b9277518d');
