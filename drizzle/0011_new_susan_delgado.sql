CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"program" varchar(255),
	"serial" varchar(40) NOT NULL,
	"gpa" numeric(4, 2),
	"issued_date" date NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_serial_idx" ON "credentials" USING btree ("serial");--> statement-breakpoint
CREATE INDEX "credentials_student_idx" ON "credentials" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "credentials_branch_idx" ON "credentials" USING btree ("branch_id");