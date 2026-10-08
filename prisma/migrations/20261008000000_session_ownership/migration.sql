-- Existing sessions must rejoin; nullable hashes deny legacy sessions access.
ALTER TABLE "Presence" ADD COLUMN "tokenHash" TEXT;
