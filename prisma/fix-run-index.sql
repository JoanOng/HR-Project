-- ONE non-voided run per (year, month); any number of VOIDED runs allowed.
CREATE UNIQUE INDEX "PayrollRun_one_active_per_month" ON "PayrollRun"("year", "month") WHERE "activeRun" = 1;