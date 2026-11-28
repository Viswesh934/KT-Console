ALTER TABLE projects ADD COLUMN agent_qa_scope TEXT NOT NULL DEFAULT 'gist_and_materials';

ALTER TABLE members ADD COLUMN experience_level TEXT NOT NULL DEFAULT 'mid';

ALTER TABLE learning_materials ADD COLUMN answer_key TEXT NOT NULL DEFAULT '';
ALTER TABLE learning_materials ADD COLUMN source_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS learning_progress (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed',
  response_text TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(member_id, material_id)
);

ALTER TABLE agent_connections ADD COLUMN label TEXT NOT NULL DEFAULT 'Local Agent';
ALTER TABLE agent_connections ADD COLUMN user_code TEXT;
ALTER TABLE agent_connections ADD COLUMN last_used_at TEXT;

CREATE TABLE IF NOT EXISTS agent_qa_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  scope_used TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
