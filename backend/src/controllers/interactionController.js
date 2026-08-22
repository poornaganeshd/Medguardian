'use strict';

const Medicine = require('../models/Medicine');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const interactionService = require('../services/drugInteractionService');
const { resolvePatientId } = require('./medicineController');

/** Checks every active medicine the patient is taking against each other. */
const checkMyMedicines = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);

  const query = { patient: patientId, isActive: true };
  const medicines = await Medicine.find(query).select(
    'name genericName normalizedName strength dosageForm unit image'
  );

  const result = interactionService.checkInteractions(
    medicines.map((m) => ({
      id: String(m._id),
      name: m.name,
      genericName: m.genericName,
      normalizedName: m.normalizedName
    }))
  );

  return ok(res, {
    ...result,
    medicines: medicines.map((m) => m.toJSON())
  });
});

/**
 * Ad-hoc check for a list of typed names - lets a patient test a medicine
 * before adding it, or check something bought over the counter.
 */
const checkNames = asyncHandler(async (req, res) => {
  const { names, includeMyMedicines } = req.body;

  let medicines = names.map((name) => ({ id: null, name }));

  if (includeMyMedicines) {
    const patientId = resolvePatientId(req);
    const stored = await Medicine.find({ patient: patientId, isActive: true }).select(
      'name genericName normalizedName'
    );
    medicines = medicines.concat(
      stored.map((m) => ({
        id: String(m._id),
        name: m.name,
        genericName: m.genericName,
        normalizedName: m.normalizedName
      }))
    );
  }

  const result = interactionService.checkInteractions(medicines);
  return ok(res, { ...result, checkedNames: names });
});

/** Dataset provenance - surfaced in the UI so demo data is never mistaken for clinical data. */
const getDatasetInfo = asyncHandler(async (req, res) =>
  ok(res, {
    dataset: interactionService.datasetInfo(),
    knownSubstances: interactionService.knownSubstances()
  })
);

module.exports = { checkMyMedicines, checkNames, getDatasetInfo };
