-- Only the current pending/active pair is retained. Existing sessions must re-enter.
ALTER TABLE "Presence"
ADD COLUMN "connectionId" TEXT,
ADD COLUMN "peerId" TEXT,
ADD COLUMN "initiatorId" TEXT,
ADD COLUMN "requestedAt" TIMESTAMP(3);

ALTER TABLE "Signal" ADD COLUMN "connectionId" TEXT;

CREATE INDEX "Presence_peerId_idx" ON "Presence"("peerId");
CREATE INDEX "Presence_requestedAt_idx" ON "Presence"("requestedAt");
