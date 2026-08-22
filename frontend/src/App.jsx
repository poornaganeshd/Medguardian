import { Routes, Route, Navigate } from 'react-router-dom';

import AppLayout from './components/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Reminders from './pages/Reminders';
import Medicines from './pages/Medicines';
import MedicineForm from './pages/MedicineForm';
import MedicineDetails from './pages/MedicineDetails';
import Schedules from './pages/Schedules';
import History from './pages/History';
import Adherence from './pages/Adherence';
import Interactions from './pages/Interactions';
import Records from './pages/Records';
import RecordDetails from './pages/RecordDetails';
import OcrVerification from './pages/OcrVerification';
import Caregivers from './pages/Caregivers';
import MedicineInfo from './pages/MedicineInfo';
import VisitSummary from './pages/VisitSummary';
import Insights from './pages/Insights';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      {/* ---------------------------------------------------------- public */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* ------------------------------------------------------- protected */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reminders" element={<Reminders />} />

        <Route path="/medicines" element={<Medicines />} />
        <Route path="/medicines/new" element={<MedicineForm />} />
        <Route path="/medicines/:id" element={<MedicineDetails />} />
        <Route path="/medicines/:id/edit" element={<MedicineForm />} />

        <Route path="/schedules" element={<Schedules />} />
        <Route path="/history" element={<History />} />
        <Route path="/adherence" element={<Adherence />} />
        <Route path="/interactions" element={<Interactions />} />

        <Route path="/records" element={<Records />} />
        <Route path="/records/:id" element={<RecordDetails />} />
        <Route path="/records/:id/verify" element={<OcrVerification />} />

        <Route path="/caregivers" element={<Caregivers />} />
        <Route path="/medicine-info" element={<MedicineInfo />} />
        <Route path="/visit-summary" element={<VisitSummary />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      {/* ------------------------------------------------------ fallbacks */}
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
