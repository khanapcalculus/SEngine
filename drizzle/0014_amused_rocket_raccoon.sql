ALTER TABLE "payroll_records" ADD COLUMN "sessions_worked" integer;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "hours_worked" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "base_rate" numeric(10, 2) DEFAULT '25.00' NOT NULL;