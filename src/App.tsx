import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { ApiErrorNotice } from './components/shared/ApiErrorNotice'
import { GoogleAnalytics } from './components/shared/GoogleAnalytics'
import { RedirectToFarmWorkspace, RequireAdmin, RequireAuth, RequireFarmWorkspace } from './components/auth/Guards'
import { LoginSheetProvider } from './components/auth/LoginSheet'
import { ProfileCompletionProvider } from './components/auth/ProfileCompletionProvider'
import { Landing } from './pages/Landing'
import { AccountCopyPage, LegacyAccountCopyRedirect } from './pages/AccountCopyPage'
import { Login } from './pages/auth/Login'
import { AuthCallback } from './pages/auth/AuthCallback'
import { AdminLogin } from './pages/auth/AdminLogin'
import { FarmStore } from './pages/order/FarmStore'
import { FarmLanding } from './pages/order/FarmLanding'
import { Checkout } from './pages/order/Checkout'
import { OrderComplete } from './pages/order/OrderComplete'
import { MyOrders } from './pages/me/MyOrders'
import { MyOrderDetail } from './pages/me/MyOrderDetail'
import { AdminFarmLayout } from './lib/farmWorkspace'
import { FarmDashboard } from './pages/farm/Dashboard'
import { FarmOrders } from './pages/farm/Orders'
import { FarmOrderCreate } from './pages/farm/OrderCreate'
import { FarmDelivery } from './pages/farm/Delivery'
import { FarmProducts } from './pages/farm/Products'
import { FarmSettings } from './pages/farm/Settings'
import { AdminDashboard } from './pages/admin/Dashboard'
import { AdminFarms } from './pages/admin/Farms'
import { AdminOrders } from './pages/admin/Orders'
import { AdminDepositLedger } from './pages/admin/DepositLedger'
import { AdminDeposits } from './pages/admin/Deposits'
import { AdminShipments } from './pages/admin/Shipments'
import { AdminShippingHistory } from './pages/admin/ShippingHistory'
import { AdminShippingManual } from './pages/admin/ShippingManual'

function RedirectLegacyStore({ suffix = '' }: { suffix?: string }) {
  const { farmSlug = '' } = useParams()
  return <Navigate to={`/farm/${farmSlug}${suffix}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <GoogleAnalytics />
      <LoginSheetProvider>
        <ProfileCompletionProvider>
        <ApiErrorNotice />
        <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/a" element={<LegacyAccountCopyRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/o/:farmSlug" element={<RedirectLegacyStore />} />
        <Route path="/o/:farmSlug/checkout" element={<RedirectLegacyStore suffix="/checkout" />} />
        <Route path="/farm" element={<RedirectToFarmWorkspace />} />
        <Route path="/farm/products" element={<RedirectToFarmWorkspace suffix="/products" />} />
        <Route path="/farm/orders" element={<RedirectToFarmWorkspace suffix="/orders" />} />
        <Route path="/farm/delivery" element={<RedirectToFarmWorkspace suffix="/delivery" />} />
        <Route path="/farm/settings" element={<RedirectToFarmWorkspace suffix="/settings" />} />
        <Route path="/farm/:farmSlug" element={<FarmStore />} />
        <Route path="/farm/:farmSlug/landingpage" element={<FarmLanding />} />
        <Route path="/farm/:farmSlug/qr" element={<AccountCopyPage />} />
        <Route
          path="/farm/:farmSlug/checkout"
          element={
            <RequireAuth>
              <Checkout />
            </RequireAuth>
          }
        />
        <Route
          path="/me/orders"
          element={
            <RequireAuth>
              <MyOrders />
            </RequireAuth>
          }
        />
        <Route
          path="/me/orders/:orderId/complete"
          element={
            <RequireAuth>
              <OrderComplete />
            </RequireAuth>
          }
        />
        <Route
          path="/me/orders/:orderId"
          element={
            <RequireAuth>
              <MyOrderDetail />
            </RequireAuth>
          }
        />
        <Route path="/apply" element={<Navigate to="/" replace />} />
        <Route path="/apply/status" element={<Navigate to="/" replace />} />
        <Route path="/manage" element={<RedirectToFarmWorkspace />} />
        <Route path="/manage/*" element={<RedirectToFarmWorkspace />} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/deposits/ledger"
          element={
            <RequireAdmin>
              <AdminDepositLedger />
            </RequireAdmin>
          }
        />
        <Route path="/admin/applications" element={<Navigate to="/admin/farms" replace />} />
        <Route
          path="/admin/farms"
          element={
            <RequireAdmin>
              <AdminFarms />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/farms/:farmId"
          element={
            <RequireFarmWorkspace>
              <AdminFarmLayout />
            </RequireFarmWorkspace>
          }
        >
          <Route index element={<FarmDashboard />} />
          <Route path="products" element={<FarmProducts />} />
          <Route path="orders" element={<FarmOrders />} />
          <Route path="orders/new" element={<FarmOrderCreate />} />
          <Route path="delivery" element={<FarmDelivery />} />
          <Route path="settings" element={<FarmSettings />} />
        </Route>
        <Route path="/admin/products" element={<Navigate to="/admin/farms" replace />} />
        <Route
          path="/admin/orders"
          element={
            <RequireAdmin>
              <AdminOrders />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/deposits"
          element={
            <RequireAdmin>
              <AdminDeposits />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/shipments"
          element={
            <RequireAdmin>
              <AdminShipments />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/shipping-history"
          element={
            <RequireAdmin>
              <AdminShippingHistory />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/shipping-manual"
          element={
            <RequireAdmin>
              <AdminShippingManual />
            </RequireAdmin>
          }
        />

        <Route path="/orders" element={<RedirectToFarmWorkspace suffix="/orders" />} />
        <Route path="/delivery" element={<RedirectToFarmWorkspace suffix="/delivery" />} />
        <Route path="/settings" element={<RedirectToFarmWorkspace suffix="/settings" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ProfileCompletionProvider>
      </LoginSheetProvider>
    </BrowserRouter>
  )
}
