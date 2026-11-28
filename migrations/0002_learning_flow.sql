ALTER TABLE projects ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN source_label TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_project_kind
  ON learning_materials(project_id, kind, level);

CREATE INDEX IF NOT EXISTS idx_attempts_project_learner
  ON quiz_attempts(project_id, learner_id, completed_at DESC);
