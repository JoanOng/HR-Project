/*
  Warnings:

  - Added the required column `country` to the `Holiday` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "country" TEXT NOT NULL DEFAULT 'SG',
    "maxHoursPerDay" INTEGER NOT NULL DEFAULT 12,
    "standardDailyHours" INTEGER NOT NULL DEFAULT 8,
    "maxOvertimePerDay" INTEGER NOT NULL DEFAULT 4,
    "maxHoursPerPeriod" INTEGER NOT NULL DEFAULT 176,
    "maxBackDatedDays" INTEGER NOT NULL DEFAULT 60,
    "allowEmptySubmit" BOOLEAN NOT NULL DEFAULT true,
    "allowHolidayWork" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppConfig" ("allowEmptySubmit", "allowHolidayWork", "createdAt", "id", "maxBackDatedDays", "maxHoursPerDay", "maxHoursPerPeriod", "maxOvertimePerDay", "standardDailyHours", "updatedAt") SELECT "allowEmptySubmit", "allowHolidayWork", "createdAt", "id", "maxBackDatedDays", "maxHoursPerDay", "maxHoursPerPeriod", "maxOvertimePerDay", "standardDailyHours", "updatedAt" FROM "AppConfig";
DROP TABLE "AppConfig";
ALTER TABLE "new_AppConfig" RENAME TO "AppConfig";
CREATE TABLE "new_Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "country" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Holiday" ("createdAt", "date", "id", "name") SELECT "createdAt", "date", "id", "name" FROM "Holiday";
DROP TABLE "Holiday";
ALTER TABLE "new_Holiday" RENAME TO "Holiday";
CREATE UNIQUE INDEX "Holiday_country_date_key" ON "Holiday"("country", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
