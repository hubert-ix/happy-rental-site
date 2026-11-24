-- Scores are now out of 10. Converts any score set on the old 0–100 scale (e.g. 85 becomes 9).
-- Run once in the Supabase SQL editor.
update listings set score_override = least(10, round(score_override / 10.0))
where score_override > 10;
