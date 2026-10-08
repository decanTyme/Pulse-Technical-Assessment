-- Optional, session-scoped conversation starter. Deleted with its presence row.
ALTER TABLE "Presence" ADD COLUMN "status" TEXT;
