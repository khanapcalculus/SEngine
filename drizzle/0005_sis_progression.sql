CREATE TYPE "public"."student_promotion_outcome" AS ENUM('promoted', 'retained', 'graduated');--> statement-breakpoint
CREATE TABLE "student_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"term" varchar(64) NOT NULL,
	"from_level" integer NOT NULL,
	"to_level" integer NOT NULL,
	"term_gpa" numeric(4, 2),
	"outcome" "student_promotion_outcome" NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "credits" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "current_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_promotions_student_created_idx" ON "student_promotions" USING btree ("student_id","created_at");