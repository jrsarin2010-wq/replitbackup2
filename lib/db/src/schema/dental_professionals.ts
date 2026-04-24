import { pgTable, text, serial, timestamp, integer, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dentalProfessionalsTable = pgTable("dental_professionals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  specialty: varchar("specialty", { length: 255 }),
  specialties: text("specialties"),
  cro: varchar("cro", { length: 50 }),
  workingDays: text("working_days").notNull().default("1,2,3,4,5"),
  workingHoursStart: varchar("working_hours_start", { length: 5 }).notNull().default("08:00"),
  workingHoursEnd: varchar("working_hours_end", { length: 5 }).notNull().default("18:00"),
  lunchStart: varchar("lunch_start", { length: 5 }).notNull().default("12:00"),
  lunchEnd: varchar("lunch_end", { length: 5 }).notNull().default("13:00"),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
  acceptsInsurance: boolean("accepts_insurance").notNull().default(false),
  consultationFee: varchar("consultation_fee", { length: 20 }),
  chargesConsultation: boolean("charges_consultation").notNull().default(true),
  defaultLeadDurationMinutes: integer("default_lead_duration_minutes").notNull().default(30),
  defaultPatientDurationMinutes: integer("default_patient_duration_minutes").notNull().default(30),
  insurancePlans: text("insurance_plans"),
  insuranceDays: text("insurance_days"),
  insuranceHoursStart: varchar("insurance_hours_start", { length: 5 }),
  insuranceHoursEnd: varchar("insurance_hours_end", { length: 5 }),
  instagramUrl: varchar("instagram_url", { length: 500 }),
  profilePhotoUrl: varchar("profile_photo_url", { length: 500 }),
  welcomeVideoUrl: varchar("welcome_video_url", { length: 1000 }),
  welcomeAudioUrl: varchar("welcome_audio_url", { length: 1000 }),
  pixKey: varchar("pix_key", { length: 255 }),
  pixEnabled: boolean("pix_enabled").notNull().default(false),
  pixMode: varchar("pix_mode", { length: 20 }).notNull().default("optional"),
  pixBank: varchar("pix_bank", { length: 100 }),
  pixKeyType: varchar("pix_key_type", { length: 20 }),
  isOwner: boolean("is_owner").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalProfessionalSchema = createInsertSchema(dentalProfessionalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDentalProfessional = z.infer<typeof insertDentalProfessionalSchema>;
export type DentalProfessional = typeof dentalProfessionalsTable.$inferSelect;
