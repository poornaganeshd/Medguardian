'use strict';

const request = require('supertest');
const sharp = require('sharp');
const app = require('../../src/app');
const MedicalRecord = require('../../src/models/MedicalRecord');
const AuditLog = require('../../src/models/AuditLog');
const Medicine = require('../../src/models/Medicine');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader, getStepUpToken } = require('../helpers/factories');

const pdfBytes = () =>
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const pngBytes = () =>
  sharp({ create: { width: 400, height: 200, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();

async function createRecord(session, fields = {}, file = null) {
  const req = request(app).post('/api/records').set(authHeader(session.accessToken));
  const payload = { title: 'Blood test', category: 'lab_report', ...fields };
  for (const [key, value] of Object.entries(payload)) {
    req.field(key, String(value));
  }
  if (file) req.attach('file', file.buffer, file.name);
  return req;
}

describeIfDb('medical records CRUD', () => {
  itIfDb('creates a record without a file', async () => {
    const session = await registerUser();
    const res = await createRecord(session, {
      title: 'Annual check-up',
      category: 'consultation_note',
      description: 'Routine review',
      provider: 'City Clinic'
    }).expect(201);

    expect(res.body.data.record.title).toBe('Annual check-up');
    expect(res.body.data.record.hasFile).toBe(false);
    expect(res.body.data.record.shareableWithCaregivers).toBe(false);
  });

  itIfDb('stores an uploaded document with checksum and metadata', async () => {
    const session = await registerUser();
    const res = await createRecord(
      session,
      { title: 'Pharmacy bill', category: 'pharmacy_bill', runOcr: 'false' },
      { buffer: pdfBytes(), name: 'bill.pdf' }
    ).expect(201);

    const { file } = res.body.data.record;
    expect(file.originalName).toBe('bill.pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.checksum).toHaveLength(64);
    expect(file.url).toMatch(/^\/api\/records\/[0-9a-f]{24}\/file$/);
  });

  itIfDb('rejects an unsupported file type', async () => {
    const session = await registerUser();
    const res = await createRecord(
      session,
      { title: 'Script', category: 'other' },
      { buffer: Buffer.from('#!/bin/sh'), name: 'evil.sh' }
    ).expect(400);
    expect(res.body.message).toMatch(/Unsupported file type/i);
  });

  itIfDb('lists and filters a patient records', async () => {
    const session = await registerUser();
    await createRecord(session, { title: 'Blood test', category: 'lab_report' }).expect(201);
    await createRecord(session, { title: 'Old script', category: 'prescription' }).expect(201);

    const all = await request(app)
      .get('/api/records')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(all.body.data.total).toBe(2);

    const filtered = await request(app)
      .get('/api/records?category=prescription')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].title).toBe('Old script');

    const searched = await request(app)
      .get('/api/records?search=blood')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(searched.body.data.total).toBe(1);
  });

  itIfDb('never lists another patient records', async () => {
    const owner = await registerUser();
    await createRecord(owner, { title: 'Private note', category: 'other' }).expect(201);

    const stranger = await registerUser();
    const res = await request(app)
      .get('/api/records')
      .set(authHeader(stranger.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(0);
  });

  itIfDb('audit-logs every record view', async () => {
    const session = await registerUser();
    const createRes = await createRecord(session, { title: 'Discharge', category: 'discharge_summary' });

    await request(app)
      .get(`/api/records/${createRes.body.data.record.id}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'RECORD_VIEWED' });
    expect(entry).toBeTruthy();
    expect(entry.description).toMatch(/Discharge/);
  });

  itIfDb('records a sharing change distinctly from a normal update', async () => {
    const session = await registerUser();
    const createRes = await createRecord(session, { title: 'Report', category: 'lab_report' });

    await request(app)
      .patch(`/api/records/${createRes.body.data.record.id}`)
      .set(authHeader(session.accessToken))
      .send({ shareableWithCaregivers: true })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'RECORD_SHARED' });
    expect(entry.oldValue.shareableWithCaregivers).toBe(false);
    expect(entry.newValue.shareableWithCaregivers).toBe(true);
  });

  itIfDb('requires PIN step-up to delete a record', async () => {
    const session = await registerUser();
    const createRes = await createRecord(
      session,
      { title: 'Bill', category: 'pharmacy_bill', runOcr: 'false' },
      { buffer: pdfBytes(), name: 'bill.pdf' }
    );
    const id = createRes.body.data.record.id;

    const denied = await request(app)
      .delete(`/api/records/${id}`)
      .set(authHeader(session.accessToken))
      .expect(401);
    expect(denied.body.code).toBe('STEP_UP_REQUIRED');

    const stepUpToken = await getStepUpToken(session);
    await request(app)
      .delete(`/api/records/${id}`)
      .set(authHeader(session.accessToken))
      .set('x-step-up-token', stepUpToken)
      .expect(200);

    expect(await MedicalRecord.findById(id)).toBeNull();
  });
});

describeIfDb('secure file download', () => {
  itIfDb('serves the file to the owner as an attachment and audits it', async () => {
    const session = await registerUser();
    const createRes = await createRecord(
      session,
      { title: 'Bill', category: 'pharmacy_bill', runOcr: 'false' },
      { buffer: pdfBytes(), name: 'bill.pdf' }
    );

    const res = await request(app)
      .get(`/api/records/${createRes.body.data.record.id}/file`)
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.headers['content-disposition']).toMatch(/attachment; filename="bill.pdf"/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toMatch(/no-store/);

    const entry = await AuditLog.findOne({ action: 'RECORD_FILE_DOWNLOADED' });
    expect(entry).toBeTruthy();
  });

  itIfDb('refuses the file to another patient and to anonymous callers', async () => {
    const owner = await registerUser();
    const createRes = await createRecord(
      owner,
      { title: 'Bill', category: 'pharmacy_bill', runOcr: 'false' },
      { buffer: pdfBytes(), name: 'bill.pdf' }
    );
    const url = `/api/records/${createRes.body.data.record.id}/file`;

    const stranger = await registerUser();
    await request(app).get(url).set(authHeader(stranger.accessToken)).expect(404);
    await request(app).get(url).expect(401);
  });

  itIfDb('404s when the record has no file', async () => {
    const session = await registerUser();
    const createRes = await createRecord(session, { title: 'Note', category: 'other' });
    await request(app)
      .get(`/api/records/${createRes.body.data.record.id}/file`)
      .set(authHeader(session.accessToken))
      .expect(404);
  });
});

describeIfDb('OCR workflow', () => {
  itIfDb('marks a PDF as unsupported for OCR rather than failing the upload', async () => {
    const session = await registerUser();
    const res = await createRecord(
      session,
      { title: 'Script', category: 'prescription' },
      { buffer: pdfBytes(), name: 'script.pdf' }
    ).expect(201);

    expect(res.body.data.record.ocr.status).toBe('unsupported');
    expect(res.body.data.record.ocr.error).toMatch(/PDF text extraction/i);
  });

  itIfDb('runs OCR on an image prescription and never auto-creates medicines', async () => {
    const session = await registerUser();
    const res = await createRecord(
      session,
      { title: 'Script', category: 'prescription' },
      { buffer: await pngBytes(), name: 'script.png' }
    ).expect(201);

    expect(['completed', 'failed']).toContain(res.body.data.record.ocr.status);
    // Whatever OCR found, nothing may have been written to the medicine list.
    expect(await Medicine.countDocuments({ patient: session.user.id })).toBe(0);
  }, 120000);

  itIfDb('creates medicines only from the entries the user confirms', async () => {
    const session = await registerUser();
    const createRes = await createRecord(
      session,
      { title: 'Script', category: 'prescription' },
      { buffer: await pngBytes(), name: 'script.png' }
    ).expect(201);
    const id = createRes.body.data.record.id;

    // Force a known OCR state so the confirmation step is tested deterministically.
    await MedicalRecord.updateOne(
      { _id: id },
      {
        'ocr.status': 'completed',
        'ocr.verificationStatus': 'awaiting_verification',
        'ocr.suggestedMedicines': [
          { rawText: 'Tab Metformin 500mg', normalizedName: 'metformin', confidence: 0.9 },
          { rawText: 'Tab Garbage 10mg', normalizedName: 'garbage', confidence: 0.3 }
        ]
      }
    );

    const res = await request(app)
      .post(`/api/records/${id}/ocr/confirm`)
      .set(authHeader(session.accessToken))
      .send({
        accepted: [
          { name: 'Metformin', strength: '500 mg', initialQuantity: 30, refillThreshold: 5 }
        ]
      })
      .expect(201);

    expect(res.body.data.createdMedicines).toHaveLength(1);
    expect(res.body.data.createdMedicines[0].name).toBe('Metformin');
    expect(res.body.data.record.ocr.verificationStatus).toBe('verified');

    const medicines = await Medicine.find({ patient: session.user.id });
    expect(medicines).toHaveLength(1);
    expect(medicines[0].normalizedName).toBe('metformin');

    const audit = await AuditLog.findOne({ action: 'OCR_RESULT_CONFIRMED' });
    expect(audit.newValue.accepted).toBe(1);
  }, 120000);

  itIfDb('discards every suggestion when the user rejects them', async () => {
    const session = await registerUser();
    const createRes = await createRecord(
      session,
      { title: 'Script', category: 'prescription' },
      { buffer: await pngBytes(), name: 'script.png' }
    ).expect(201);
    const id = createRes.body.data.record.id;

    await MedicalRecord.updateOne(
      { _id: id },
      {
        'ocr.status': 'completed',
        'ocr.verificationStatus': 'awaiting_verification',
        'ocr.suggestedMedicines': [
          { rawText: 'Tab Metformin 500mg', normalizedName: 'metformin', confidence: 0.9 }
        ]
      }
    );

    const res = await request(app)
      .post(`/api/records/${id}/ocr/confirm`)
      .set(authHeader(session.accessToken))
      .send({ rejectAll: true })
      .expect(200);

    expect(res.body.data.createdMedicines).toEqual([]);
    expect(res.body.data.record.ocr.verificationStatus).toBe('rejected');
    expect(await Medicine.countDocuments({ patient: session.user.id })).toBe(0);
  }, 120000);

  itIfDb('refuses confirmation when OCR has not been run', async () => {
    const session = await registerUser();
    const createRes = await createRecord(session, { title: 'Note', category: 'other' });
    await request(app)
      .post(`/api/records/${createRes.body.data.record.id}/ocr/confirm`)
      .set(authHeader(session.accessToken))
      .send({ accepted: [{ name: 'Sneaky' }] })
      .expect(400);
    expect(await Medicine.countDocuments({ patient: session.user.id })).toBe(0);
  });
});
