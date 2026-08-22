import api, { unwrap } from './api';

/**
 * Thin, typed-by-convention wrappers around the MedGuardian API.
 * Keeping every URL in one file means a route change touches one place.
 */

// ------------------------------------------------------------------- auth
export const authApi = {
  register: (payload) => api.post('/auth/register', payload).then(unwrap),
  login: (payload) => api.post('/auth/login', payload).then(unwrap),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }).then(unwrap),
  me: () => api.get('/auth/me').then(unwrap),
  updateProfile: (payload) => api.patch('/auth/me', payload).then(unwrap),
  changePassword: (payload) => api.post('/auth/change-password', payload).then(unwrap),
  setPin: (payload) => api.post('/auth/pin', payload).then(unwrap),
  verifyPin: (pin) => api.post('/auth/pin/verify', { pin }).then(unwrap),
  webauthn: {
    registrationOptions: () => api.post('/auth/webauthn/register/options').then(unwrap),
    verifyRegistration: (payload) =>
      api.post('/auth/webauthn/register/verify', payload).then(unwrap),
    authenticationOptions: () => api.post('/auth/webauthn/authenticate/options').then(unwrap),
    verifyAuthentication: (payload) =>
      api.post('/auth/webauthn/authenticate/verify', payload).then(unwrap),
    remove: (credentialId) => api.delete(`/auth/webauthn/${credentialId}`).then(unwrap)
  }
};

// -------------------------------------------------------------- medicines
export const medicineApi = {
  list: (params) => api.get('/medicines', { params }).then(unwrap),
  get: (id) => api.get(`/medicines/${id}`).then(unwrap),
  create: (payload) => api.post('/medicines', payload).then(unwrap),
  update: (id, payload) => api.patch(`/medicines/${id}`, payload).then(unwrap),
  remove: (id) => api.delete(`/medicines/${id}`).then(unwrap),
  adjustStock: (id, payload) => api.post(`/medicines/${id}/stock`, payload).then(unwrap),
  uploadImage: (id, file) => {
    const form = new FormData();
    form.append('image', file);
    return api
      .post(`/medicines/${id}/image`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      .then(unwrap);
  },
  removeImage: (id) => api.delete(`/medicines/${id}/image`).then(unwrap),
  imageUrl: (id, variant) =>
    `${import.meta.env.VITE_API_URL || '/api'}/medicines/${id}/image${variant ? `?variant=${variant}` : ''}`
};

// -------------------------------------------------------------- schedules
export const scheduleApi = {
  list: (params) => api.get('/schedules', { params }).then(unwrap),
  get: (id) => api.get(`/schedules/${id}`).then(unwrap),
  create: (payload) => api.post('/schedules', payload).then(unwrap),
  update: (id, payload) => api.patch(`/schedules/${id}`, payload).then(unwrap),
  setStatus: (id, payload) => api.patch(`/schedules/${id}/status`, payload).then(unwrap),
  remove: (id) => api.delete(`/schedules/${id}`).then(unwrap),
  occurrences: (params) => api.get('/schedules/occurrences', { params }).then(unwrap)
};

// ---------------------------------------------------------------- intakes
export const intakeApi = {
  list: (params) => api.get('/intakes', { params }).then(unwrap),
  record: (payload) => api.post('/intakes', payload).then(unwrap),
  recordAsNeeded: (payload) => api.post('/intakes/as-needed', payload).then(unwrap),
  update: (id, payload) => api.patch(`/intakes/${id}`, payload).then(unwrap),
  remove: (id) => api.delete(`/intakes/${id}`).then(unwrap)
};

// -------------------------------------------------------------- analytics
export const analyticsApi = {
  adherence: (params) => api.get('/analytics/adherence', { params }).then(unwrap),
  refillOverview: (params) => api.get('/analytics/refill', { params }).then(unwrap),
  refillFor: (medicineId, params) =>
    api.get(`/analytics/refill/${medicineId}`, { params }).then(unwrap)
};

// ----------------------------------------------------------- interactions
export const interactionApi = {
  myMedicines: (params) => api.get('/interactions/my-medicines', { params }).then(unwrap),
  check: (payload) => api.post('/interactions/check', payload).then(unwrap),
  dataset: () => api.get('/interactions/dataset').then(unwrap)
};

// ---------------------------------------------------------------- records
export const recordApi = {
  list: (params) => api.get('/records', { params }).then(unwrap),
  get: (id) => api.get(`/records/${id}`).then(unwrap),
  create: (formData) =>
    api
      .post('/records', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(unwrap),
  update: (id, payload) => api.patch(`/records/${id}`, payload).then(unwrap),
  remove: (id) => api.delete(`/records/${id}`).then(unwrap),
  runOcr: (id) => api.post(`/records/${id}/ocr`).then(unwrap),
  confirmOcr: (id, payload) => api.post(`/records/${id}/ocr/confirm`, payload).then(unwrap),
  download: (id) => api.get(`/records/${id}/file`, { responseType: 'blob' })
};

// ------------------------------------------------------------- caregivers
export const caregiverApi = {
  list: (params) => api.get('/caregivers', { params }).then(unwrap),
  invite: (payload) => api.post('/caregivers', payload).then(unwrap),
  respond: (payload) => api.post('/caregivers/respond', payload).then(unwrap),
  updatePermissions: (id, payload) =>
    api.patch(`/caregivers/${id}/permissions`, payload).then(unwrap),
  revoke: (id) => api.delete(`/caregivers/${id}`).then(unwrap),
  patientSummary: (patientId) =>
    api.get(`/caregivers/patients/${patientId}/summary`).then(unwrap)
};

// -------------------------------------------------------------- assistant
export const assistantApi = {
  medicineInfo: (payload) => api.post('/assistant/medicine-info', payload).then(unwrap),
  knowledgeBase: () => api.get('/assistant/medicine-info/knowledge-base').then(unwrap),
  visitSummary: (payload) => api.post('/assistant/visit-summary', payload).then(unwrap),
  insights: (params) => api.get('/assistant/insights', { params }).then(unwrap)
};

// -------------------------------------------------------------- dashboard
export const dashboardApi = {
  get: (params) => api.get('/dashboard', { params }).then(unwrap)
};

// ------------------------------------------------------------------ audit
export const auditApi = {
  list: (params) => api.get('/audit', { params }).then(unwrap),
  actions: () => api.get('/audit/actions').then(unwrap)
};
