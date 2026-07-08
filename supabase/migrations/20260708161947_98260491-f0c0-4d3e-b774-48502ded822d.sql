
-- Backup current content of the 7 corrupted articles
INSERT INTO article_versions (article_id, user_id, title, content, reason, word_count)
SELECT a.id, a.user_id, a.title, a.content, 'pre_restore_backup_20260708_batch',
       array_length(regexp_split_to_array(trim(a.content), '\s+'), 1)
FROM articles a
WHERE a.id IN (
  'c91ab76d-dddd-4980-a933-76ec0bd9ae1e',
  '6faa1ec7-34d5-4579-a61f-b4ef9b6db1dc',
  'ecff0eb9-6585-4600-a94f-15c7115cd5c9',
  '2a514730-434e-4421-8922-8cbaf4f7a1bb',
  '43de6bc2-4388-40e0-a3e4-b1920f55d858',
  '9da9e408-3106-4582-af47-257bba086dc0',
  'e8292451-7d48-47d6-82cb-773456a4e707'
);

-- Restore from earliest auto_improve_before snapshot for each
WITH snaps AS (
  SELECT DISTINCT ON (av.article_id)
    av.article_id, av.content
  FROM article_versions av
  WHERE av.reason = 'auto_improve_before'
    AND av.article_id IN (
      'c91ab76d-dddd-4980-a933-76ec0bd9ae1e',
      '6faa1ec7-34d5-4579-a61f-b4ef9b6db1dc',
      'ecff0eb9-6585-4600-a94f-15c7115cd5c9',
      '2a514730-434e-4421-8922-8cbaf4f7a1bb',
      '43de6bc2-4388-40e0-a3e4-b1920f55d858',
      '9da9e408-3106-4582-af47-257bba086dc0',
      'e8292451-7d48-47d6-82cb-773456a4e707'
    )
  ORDER BY av.article_id, av.created_at ASC
)
UPDATE articles a
SET content = s.content,
    updated_at = now()
FROM snaps s
WHERE a.id = s.article_id;
