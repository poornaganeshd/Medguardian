'use strict';

const mongoose = require('mongoose');

/**
 * Removes everything that hangs off a medicine when it is deleted.
 *
 * Models are looked up lazily through the mongoose registry so this module
 * stays usable during the phased build (a model that does not exist yet is
 * simply reported as 0 removals).
 */
async function purgeMedicineDependencies(medicineId) {
  const result = { schedules: 0, intakes: 0 };

  const Schedule = mongoose.models.Schedule;
  const Intake = mongoose.models.Intake;

  if (Schedule) {
    const scheduleIds = await Schedule.find({ medicine: medicineId }).distinct('_id');
    if (Intake && scheduleIds.length) {
      const intakeResult = await Intake.deleteMany({ schedule: { $in: scheduleIds } });
      result.intakes += intakeResult.deletedCount || 0;
    }
    const scheduleResult = await Schedule.deleteMany({ medicine: medicineId });
    result.schedules = scheduleResult.deletedCount || 0;
  }

  if (Intake) {
    const intakeResult = await Intake.deleteMany({ medicine: medicineId });
    result.intakes += intakeResult.deletedCount || 0;
  }

  return result;
}

module.exports = { purgeMedicineDependencies };
