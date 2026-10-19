-- Section 7.2: at most one live request per (case, helper, kind). Finished requests do not count.
CREATE UNIQUE INDEX "HelperRequest_open_unique"
  ON "HelperRequest" ("caseId", "membershipId", "kind")
  WHERE "state" IN ('sent', 'delivered', 'acked');
