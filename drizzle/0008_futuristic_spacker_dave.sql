CREATE TABLE "guardianships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"relationship" varchar(64) DEFAULT 'guardian' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardianships_parent_student_idx" ON "guardianships" USING btree ("parent_user_id","student_profile_id");--> statement-breakpoint
CREATE INDEX "guardianships_parent_idx" ON "guardianships" USING btree ("parent_user_id");--> statement-breakpoint
CREATE INDEX "guardianships_student_idx" ON "guardianships" USING btree ("student_profile_id");