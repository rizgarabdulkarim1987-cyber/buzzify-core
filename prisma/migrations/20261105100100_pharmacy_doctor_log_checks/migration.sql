-- The AI Doctor's log keeps only the three modes and three outcomes the service writes, and at most 280 characters of the
-- question (null for a photo). Additive: the table is new and holds no rows outside these rules.
ALTER TABLE "PhDoctorLog" ADD CONSTRAINT "PhDoctorLog_mode_check" CHECK ("mode" IN ('COMPLAINT', 'MEDICINE_NAME', 'MEDICINE_PHOTO'));
ALTER TABLE "PhDoctorLog" ADD CONSTRAINT "PhDoctorLog_outcome_check" CHECK ("outcome" IN ('ANSWERED', 'REFUSED', 'FAILED'));
ALTER TABLE "PhDoctorLog" ADD CONSTRAINT "PhDoctorLog_questionText_length" CHECK ("questionText" IS NULL OR char_length("questionText") <= 280);
