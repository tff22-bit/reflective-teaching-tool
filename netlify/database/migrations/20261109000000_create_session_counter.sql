-- Total number of reflection sessions started. One row, one number. No personal data.
CREATE TABLE session_counter (
  id INTEGER PRIMARY KEY,
  total BIGINT NOT NULL DEFAULT 0
);
INSERT INTO session_counter (id, total) VALUES (1, 0);

-- Short-lived rate-limit buckets. The key is a salted hash of the caller's address,
-- per hour; rows older than a day are deleted on every start request.
CREATE TABLE start_limits (
  h TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (h, bucket)
);
