import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_HOME, useAuth } from './lib/auth';
import { AppLayout, PublicLayout } from './components/layout';
import { Spinner } from './components/ui';
import { LoginPage, RegisterPage } from './pages/auth';
import { BloodGroupsPage, ContactPage, HomePage, HowItWorksPage, PrivacyPage } from './pages/public';
import { DonorAlerts, DonorDashboard, DonorHistory, DonorProfilePage } from './pages/donor';
import {
  HospitalDashboard,
  HospitalStatsPage,
  HospitalUrgences,
  NewUrgencePage,
  StockPage,
  UrgenceDetailPage,
} from './pages/hospital';
import {
  AdminAudit,
  AdminHospitals,
  AdminNotifications,
  AdminOverview,
  AdminServices,
  AdminUrgences,
  AdminUsers,
} from './pages/admin';

function FullPageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-ink-500">
      <Spinner /> Chargement de votre espace…
    </div>
  );
}

function RequireRole({ role, children }: { role: 'DONOR' | 'HOSPITAL' | 'ADMIN'; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-5xl font-black text-blood-200">404</p>
      <h1 className="mt-2 text-xl font-bold text-ink-900">Page introuvable</h1>
      <p className="mt-2 text-sm text-ink-500">Le lien demandé n’existe pas ou a été déplacé.</p>
      <a href="/" className="btn-primary mt-6">
        Retour à l’accueil
      </a>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/fonctionnement" element={<HowItWorksPage />} />
        <Route path="/groupes-sanguins" element={<BloodGroupsPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/confidentialite" element={<PrivacyPage />} />
        <Route path="/connexion" element={<LoginPage />} />
        <Route path="/inscription" element={<RegisterPage />} />
      </Route>

      <Route
        element={
          <RequireRole role="DONOR">
            <AppLayout />
          </RequireRole>
        }
      >
        <Route path="/donneur" element={<DonorDashboard />} />
        <Route path="/donneur/alertes" element={<DonorAlerts />} />
        <Route path="/donneur/historique" element={<DonorHistory />} />
        <Route path="/donneur/profil" element={<DonorProfilePage />} />
      </Route>

      <Route
        element={
          <RequireRole role="HOSPITAL">
            <AppLayout />
          </RequireRole>
        }
      >
        <Route path="/hopital" element={<HospitalDashboard />} />
        <Route path="/hopital/urgences" element={<HospitalUrgences />} />
        <Route path="/hopital/urgences/:id" element={<UrgenceDetailPage />} />
        <Route path="/hopital/nouvelle-urgence" element={<NewUrgencePage />} />
        <Route path="/hopital/stocks" element={<StockPage />} />
        <Route path="/hopital/statistiques" element={<HospitalStatsPage />} />
      </Route>

      <Route
        element={
          <RequireRole role="ADMIN">
            <AppLayout />
          </RequireRole>
        }
      >
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/hopitaux" element={<AdminHospitals />} />
        <Route path="/admin/utilisateurs" element={<AdminUsers />} />
        <Route path="/admin/urgences" element={<AdminUrgences />} />
        <Route path="/admin/notifications" element={<AdminNotifications />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
        <Route path="/admin/services" element={<AdminServices />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
