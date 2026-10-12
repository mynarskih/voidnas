ALTER TABLE "User"
  ADD COLUMN "language" VARCHAR(8) NOT NULL DEFAULT 'en',
  ADD COLUMN "timeZone" VARCHAR(100) NOT NULL DEFAULT 'Europe/Warsaw',
  ADD COLUMN "theme" VARCHAR(8) NOT NULL DEFAULT 'dark';
ALTER TABLE "User" ADD CONSTRAINT "User_language_check" CHECK ("language" IN ('en', 'pl'));
ALTER TABLE "User" ADD CONSTRAINT "User_theme_check" CHECK ("theme" IN ('dark', 'light'));
