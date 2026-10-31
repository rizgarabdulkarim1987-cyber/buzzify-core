-- Seasonal particles: the effect a menu draws over its pages, or null for none.
ALTER TABLE "Menu" ADD COLUMN "seasonEffect" TEXT;
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_seasonEffect_check" CHECK ("seasonEffect" IS NULL OR "seasonEffect" IN ('snow', 'leaves', 'petals', 'sparks', 'confetti'));
