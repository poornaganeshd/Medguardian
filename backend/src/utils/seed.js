'use strict';

/**
 * Demo data seeder.
 *
 * Creates one patient with a realistic month of medication history so every
 * screen — adherence, the DRPA forecast, interactions, insights — has
 * something meaningful to show during a demonstration.
 *
 * Usage:  npm run seed          (adds demo data)
 *         npm run seed -- --reset   (deletes the demo account first)
 *
 * The demo account never overwrites a real one: it uses a fixed email and
 * refuses to run against a database that already holds other users unless
 * --force is passed.
 */

const { config } = require('../config/env');
const logger = require('../config/logger');
const { connectDatabase, disconnectDatabase } = require('../config/database');

const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Schedule = require('../models/Schedule');
const Intake = require('../models/Intake');
const MedicalRecord = require('../models/MedicalRecord');
const { toLocalDateKey, addDays, localDateTime } = require('./dateTime');

const DEMO_EMAIL = 'demo.patient@medguardian.local';
const DEMO_PASSWORD = 'Demo1234';
const TZ = 'Asia/Kolkata';

const MEDICINES = [
  {
    name: 'Metformin',
    genericName: 'Metformin Hydrochloride',
    strength: '500 mg',
    dosageForm: 'tablet',
    unit: 'tablet',
    purpose: 'Blood sugar control',
    instructions: 'Take one tablet after breakfast and one after dinner',
    prescriberNotes: 'Review HbA1c in three months',
    prescribedBy: 'Dr. A. Kumar',
    initialQuantity: 60,
    currentStock: 22,
    refillThreshold: 10,
    times: [
      { time: '08:00', doseQuantity: 1, label: 'Morning' },
      { time: '20:00', doseQuantity: 1, label: 'Night' }
    ],
    /** Fraction of doses the demo patient actually takes. */
    adherence: 0.9
  },
  {
    name: 'Ecosprin',
    genericName: 'Aspirin',
    strength: '75 mg',
    dosageForm: 'tablet',
    unit: 'tablet',
    purpose: 'Blood clot prevention',
    instructions: 'Take one tablet after dinner',
    initialQuantity: 30,
    currentStock: 4,
    refillThreshold: 5,
    times: [{ time: '21:00', doseQuantity: 1, label: 'After dinner' }],
    adherence: 0.75
  },
  {
    name: 'Warfarin',
    genericName: 'Warfarin',
    strength: '5 mg',
    dosageForm: 'tablet',
    unit: 'tablet',
    purpose: 'Anticoagulation',
    instructions: 'Take exactly as directed by the anticoagulation clinic',
    prescriberNotes: 'INR checked fortnightly',
    initialQuantity: 30,
    currentStock: 18,
    refillThreshold: 7,
    times: [{ time: '18:00', doseQuantity: 1, label: 'Evening' }],
    adherence: 0.95
  },
  {
    name: 'Atorvastatin',
    genericName: 'Atorvastatin',
    strength: '10 mg',
    dosageForm: 'tablet',
    unit: 'tablet',
    purpose: 'Cholesterol control',
    instructions: 'Take at bedtime',
    initialQuantity: 30,
    currentStock: 26,
    refillThreshold: 5,
    times: [{ time: '22:00', doseQuantity: 1, label: 'Bedtime' }],
    adherence: 0.6 // deliberately poor, so the insights engine flags it
  },
  {
    name: 'Paracetamol',
    genericName: 'Paracetamol',
    strength: '500 mg',
    dosageForm: 'tablet',
    unit: 'tablet',
    purpose: 'Pain and fever relief',
    instructions: 'Take only when needed, up to four times a day',
    initialQuantity: 20,
    currentStock: 16,
    refillThreshold: 5,
    asNeeded: true
  }
];

const RECORDS = [
  {
    title: 'Quarterly blood test results',
    category: 'lab_report',
    description: 'HbA1c, lipid profile and kidney function.',
    provider: 'City Diagnostics',
    doctorName: 'Dr. A. Kumar',
    tags: ['diabetes', 'routine'],
    daysAgo: 21,
    shareableWithCaregivers: true
  },
  {
    title: 'Prescription — March review',
    category: 'prescription',
    description: 'Repeat prescription for metformin, aspirin and atorvastatin.',
    provider: 'City Clinic',
    doctorName: 'Dr. A. Kumar',
    tags: ['repeat'],
    daysAgo: 21,
    shareableWithCaregivers: true
  },
  {
    title: 'Pharmacy bill — March',
    category: 'pharmacy_bill',
    description: 'Monthly medicine purchase.',
    provider: 'Wellness Pharmacy',
    tags: ['expense'],
    daysAgo: 20
  },
  {
    title: 'Cardiology consultation note',
    category: 'consultation_note',
    description: 'Follow-up after last year\'s procedure. Continue current therapy.',
    provider: 'City Hospital',
    doctorName: 'Dr. S. Rao',
    tags: ['cardiology'],
    daysAgo: 60,
    isSensitive: true
  }
];

/** Deterministic pseudo-random generator so every seed run is identical. */
function makeRandom(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

async function seed({ reset = false, force = false } = {}) {
  await connectDatabase();

  const existing = await User.findOne({ email: DEMO_EMAIL });

  if (reset && existing) {
    await Promise.all([
      Medicine.deleteMany({ patient: existing._id }),
      Schedule.deleteMany({ patient: existing._id }),
      Intake.deleteMany({ patient: existing._id }),
      MedicalRecord.deleteMany({ patient: existing._id })
    ]);
    await existing.deleteOne();
    logger.info('Removed the previous demo account');
  } else if (existing) {
    logger.warn(
      `The demo account already exists (${DEMO_EMAIL}). Re-run with --reset to rebuild it.`
    );
    await disconnectDatabase();
    return;
  }

  const otherUsers = await User.countDocuments({ email: { $ne: DEMO_EMAIL } });
  if (otherUsers > 0 && !force) {
    logger.warn(
      `This database already holds ${otherUsers} other user(s). Re-run with --force if you are sure.`
    );
    await disconnectDatabase();
    return;
  }

  // ------------------------------------------------------------- patient
  const patient = await User.create({
    name: 'Demo Patient',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    role: 'patient',
    phone: '+91 90000 00000',
    dateOfBirth: new Date('1971-06-14'),
    gender: 'prefer_not_to_say',
    bloodGroup: 'O+',
    allergies: ['penicillin'],
    conditions: ['type 2 diabetes', 'high blood pressure'],
    timezone: TZ,
    emergencyContact: { name: 'Demo Relative', relationship: 'Daughter', phone: '+91 90000 00001' }
  });

  const random = makeRandom();
  const now = new Date();
  const todayKey = toLocalDateKey(now, TZ);
  const HISTORY_DAYS = 30;
  const startKey = addDays(todayKey, -HISTORY_DAYS);

  let intakeCount = 0;

  for (const spec of MEDICINES) {
    const medicine = await Medicine.create({
      patient: patient._id,
      name: spec.name,
      genericName: spec.genericName,
      strength: spec.strength,
      dosageForm: spec.dosageForm,
      unit: spec.unit,
      purpose: spec.purpose,
      instructions: spec.instructions,
      prescriberNotes: spec.prescriberNotes,
      prescribedBy: spec.prescribedBy,
      initialQuantity: spec.initialQuantity,
      currentStock: spec.currentStock,
      refillThreshold: spec.refillThreshold
    });

    const schedule = await Schedule.create({
      patient: patient._id,
      medicine: medicine._id,
      frequency: spec.asNeeded ? 'as_needed' : 'daily',
      times: spec.times || [],
      asNeededDoseQuantity: spec.asNeeded ? 1 : undefined,
      maxDosesPerDay: spec.asNeeded ? 4 : undefined,
      startDate: localDateTime(startKey, '00:00', TZ),
      graceMinutes: 60,
      mealRelation: 'after_meal'
    });

    if (spec.asNeeded) {
      // A handful of PRN doses scattered through the month.
      for (const offset of [2, 9, 17, 25]) {
        const dateKey = addDays(todayKey, -offset);
        await Intake.create({
          patient: patient._id,
          medicine: medicine._id,
          schedule: schedule._id,
          dateKey,
          scheduledTime: 'prn',
          status: 'taken',
          takenAt: localDateTime(dateKey, '15:00', TZ),
          doseQuantity: 1,
          isAsNeeded: true,
          notes: 'Headache'
        });
        intakeCount += 1;
      }
      continue;
    }

    // Fixed schedules: build a month of history at the specified adherence.
    for (let day = HISTORY_DAYS; day >= 1; day -= 1) {
      const dateKey = addDays(todayKey, -day);
      for (const slot of spec.times) {
        const roll = random();
        // 'adherence' of the doses are taken; of the rest, half are explicitly
        // skipped and half are simply never recorded (missed).
        if (roll < spec.adherence) {
          const scheduledAt = localDateTime(dateKey, slot.time, TZ);
          const minutesLate = Math.round(random() * 90) - 10;
          await Intake.create({
            patient: patient._id,
            medicine: medicine._id,
            schedule: schedule._id,
            dateKey,
            scheduledTime: slot.time,
            scheduledAt,
            status: 'taken',
            takenAt: new Date(scheduledAt.getTime() + minutesLate * 60000),
            doseQuantity: slot.doseQuantity,
            wasLate: minutesLate > 60,
            minutesLate
          });
          intakeCount += 1;
        } else if (roll < spec.adherence + (1 - spec.adherence) / 2) {
          await Intake.create({
            patient: patient._id,
            medicine: medicine._id,
            schedule: schedule._id,
            dateKey,
            scheduledTime: slot.time,
            scheduledAt: localDateTime(dateKey, slot.time, TZ),
            status: 'skipped',
            doseQuantity: slot.doseQuantity,
            skipReason: random() < 0.6 ? 'forgot' : 'felt_better'
          });
          intakeCount += 1;
        }
        // else: no record at all -> counted as missed
      }
    }
  }

  for (const spec of RECORDS) {
    await MedicalRecord.create({
      patient: patient._id,
      title: spec.title,
      category: spec.category,
      description: spec.description,
      provider: spec.provider,
      doctorName: spec.doctorName,
      tags: spec.tags,
      recordDate: localDateTime(addDays(todayKey, -spec.daysAgo), '10:00', TZ),
      shareableWithCaregivers: Boolean(spec.shareableWithCaregivers),
      isSensitive: Boolean(spec.isSensitive)
    });
  }

  logger.info('---------------------------------------------');
  logger.info('MedGuardian demo data created');
  logger.info(`  Email:    ${DEMO_EMAIL}`);
  logger.info(`  Password: ${DEMO_PASSWORD}`);
  logger.info(`  ${MEDICINES.length} medicines, ${intakeCount} dose records, ${RECORDS.length} medical records`);
  logger.info('  Warfarin + Ecosprin will raise a major interaction alert.');
  logger.info('  Ecosprin is deliberately low on stock to demonstrate the DRPA.');
  logger.info('---------------------------------------------');

  await disconnectDatabase();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  seed({ reset: args.includes('--reset'), force: args.includes('--force') })
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Seeding failed:', error.message);
      process.exit(1);
    });
}

module.exports = { seed, DEMO_EMAIL, DEMO_PASSWORD };
