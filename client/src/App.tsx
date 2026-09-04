import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Intro, introAlreadySeen } from './components/Intro';
import { ToastProvider } from './components/Toast';
import { WorkspaceProvider } from './lib/workspace';
import { Home } from './pages/Home';
import { AllTools, CategoryPage } from './pages/Tools';
import { ToolPage } from './pages/ToolPage';
import { Transcribe } from './pages/Transcribe';
import { DocumentChatPage } from './pages/DocumentChatPage';
import { ComparePage } from './pages/Compare';
import { WorkflowsPage } from './pages/Workflows';
import { RecorderPage } from './pages/Recorder';
import { SignPdf } from './pages/SignPdf';
import { RedactPdf } from './pages/RedactPdf';
import { CropImage } from './pages/CropImage';
import { Privacy } from './pages/Privacy';
import { Admin } from './pages/Admin';
import { NotFound } from './pages/NotFound';

export default function App() {
  const [introDone, setIntroDone] = useState(() => introAlreadySeen() && !isFirstPaintHome());

  return (
    <ToastProvider>
      <WorkspaceProvider>
        {!introDone && <Intro onDone={() => setIntroDone(true)} />}
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tools" element={<AllTools />} />
            <Route path="/category/:id" element={<CategoryPage />} />
            <Route path="/transcribe" element={<Transcribe mode="file" />} />
            <Route path="/transcribe/url" element={<Transcribe mode="url" />} />
            <Route path="/ai/document-chat" element={<DocumentChatPage />} />
            <Route path="/ai/compare" element={<ComparePage />} />
            <Route path="/pdf/sign" element={<SignPdf />} />
            <Route path="/pdf/redact" element={<RedactPdf />} />
            <Route path="/image/crop" element={<CropImage />} />
            <Route path="/audio/recorder" element={<RecorderPage kind="audio" />} />
            <Route path="/video/recorder" element={<RecorderPage kind="video" />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/pdf" element={<Navigate to="/category/pdf" replace />} />
            <Route path="/image" element={<Navigate to="/category/image" replace />} />
            <Route path="/audio" element={<Navigate to="/category/audio" replace />} />
            <Route path="/video" element={<Navigate to="/category/video" replace />} />
            <Route path="/ai" element={<Navigate to="/category/ai" replace />} />
            <Route path="/business" element={<Navigate to="/category/business" replace />} />
            {/* Every remaining registry tool resolves by its clean route. */}
            <Route path="/pdf/:slug" element={<ToolPage />} />
            <Route path="/image/:slug" element={<ToolPage />} />
            <Route path="/audio/:slug" element={<ToolPage />} />
            <Route path="/video/:slug" element={<ToolPage />} />
            <Route path="/ai/:slug" element={<ToolPage />} />
            <Route path="/business/:slug" element={<ToolPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </WorkspaceProvider>
    </ToastProvider>
  );
}

/** Returning visitors skip the animation entirely. */
function isFirstPaintHome() {
  return false;
}
