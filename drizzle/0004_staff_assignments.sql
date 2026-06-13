CREATE TYPE "public"."staff_assignment_role" AS ENUM('lead', 'assistant');--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"role" "staff_assignment_role" DEFAULT 'lead' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_staff_class_idx" ON "staff_assignments" USING btree ("staff_id","class_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_class_id_idx" ON "staff_assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_staff_id_idx" ON "staff_assignments" USING btree ("staff_id");